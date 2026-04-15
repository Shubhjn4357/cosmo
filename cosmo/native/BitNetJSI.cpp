/**
 * BitNetJSI.cpp
 * =============
 * Real llama.cpp-backed JSI bridge for Cosmo AI on-device inference.
 *
 * Engine: llama.cpp C API (via llama.rn native library linkage)
 * Model:  Any GGUF file — BitNet b1.58, Qwen3, Llama-3, etc.
 * Thread: Inference runs on a dedicated background thread; synchronised
 *         back to the JSI call-site via std::condition_variable.
 *
 * Build requirements:
 *   Android: link against libllama (from llama.rn's android/jni)
 *   iOS:     link against Llama.xcframework (from llama.rn's ios/)
 */

#include "BitNetJSI.h"

#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <stdexcept>

#include "llama.h"

namespace facebook {
namespace jsi {

// ─────────────────────────────────────────────────────────────────────────────
// Constructor / Destructor
// ─────────────────────────────────────────────────────────────────────────────

BitNetJSI::BitNetJSI(
    Runtime& runtime,
    std::shared_ptr<facebook::react::CallInvoker> jsCallInvoker)
    : jsCallInvoker_(std::move(jsCallInvoker))
{
    // Initialise the llama backend (logs, NUMA detection) exactly once.
    // llama.rn does this in its own init path; guard against double-init.
    static bool backendInitialized = false;
    if (!backendInitialized) {
        llama_backend_init();
        backendInitialized = true;
    }
}

BitNetJSI::~BitNetJSI() {
    stopRequested_.store(true);
    releaseEngine();
    llama_backend_free();
}

// ─────────────────────────────────────────────────────────────────────────────
// HostObject interface
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::get(Runtime& runtime, const PropNameID& name) {
    const std::string method = name.utf8(runtime);

    if (method == "loadModel") {
        return Function::createFromHostFunction(runtime, name, 2,
            [this](Runtime& rt, const Value&, const Value* args, size_t count) -> Value {
                const Value emptyOpts = Value::undefined();
                return this->loadModel(rt, args[0], count >= 2 ? args[1] : emptyOpts);
            });
    }
    if (method == "generate") {
        return Function::createFromHostFunction(runtime, name, 2,
            [this](Runtime& rt, const Value&, const Value* args, size_t count) -> Value {
                const Value emptyOpts = Value::undefined();
                return this->generate(rt, args[0], count >= 2 ? args[1] : emptyOpts);
            });
    }
    if (method == "stopGeneration") {
        return Function::createFromHostFunction(runtime, name, 0,
            [this](Runtime& rt, const Value&, const Value*, size_t) -> Value {
                return this->stopGeneration(rt);
            });
    }
    if (method == "unloadModel") {
        return Function::createFromHostFunction(runtime, name, 0,
            [this](Runtime& rt, const Value&, const Value*, size_t) -> Value {
                return this->unloadModel(rt);
            });
    }
    if (method == "getModelInfo") {
        return Function::createFromHostFunction(runtime, name, 0,
            [this](Runtime& rt, const Value&, const Value*, size_t) -> Value {
                return this->getModelInfo(rt);
            });
    }
    if (method == "getMemoryStats") {
        return Function::createFromHostFunction(runtime, name, 0,
            [this](Runtime& rt, const Value&, const Value*, size_t) -> Value {
                return this->getMemoryStats(rt);
            });
    }
    if (method == "tokenize") {
        return Function::createFromHostFunction(runtime, name, 1,
            [this](Runtime& rt, const Value&, const Value* args, size_t) -> Value {
                return this->tokenize(rt, args[0]);
            });
    }
    if (method == "detokenize") {
        return Function::createFromHostFunction(runtime, name, 1,
            [this](Runtime& rt, const Value&, const Value* args, size_t) -> Value {
                return this->detokenize(rt, args[0]);
            });
    }

    return Value::undefined();
}

void BitNetJSI::set(Runtime&, const PropNameID&, const Value&) {
    // Read-only bridge — all writable state is managed internally.
}

std::vector<PropNameID> BitNetJSI::getPropertyNames(Runtime& runtime) {
    const char* names[] = {
        "loadModel", "generate", "stopGeneration", "unloadModel",
        "getModelInfo", "getMemoryStats", "tokenize", "detokenize"
    };
    std::vector<PropNameID> props;
    for (const auto* n : names) {
        props.push_back(PropNameID::forAscii(runtime, n));
    }
    return props;
}

// ─────────────────────────────────────────────────────────────────────────────
// loadModel
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::loadModel(Runtime& runtime, const Value& pathVal, const Value& optionsVal) {
    if (!pathVal.isString()) {
        throw JSError(runtime, "[BitNet] loadModel: path must be a string");
    }

    std::string path = pathVal.asString(runtime).utf8(runtime);

    // Strip the "file://" prefix that React Native's file-system APIs add.
    if (path.substr(0, 7) == "file://") {
        path = path.substr(7);
    }

    std::lock_guard<std::mutex> lock(engineMutex_);

    // Unload any previously loaded model.
    releaseEngine();

    // ── Model params ──────────────────────────────────────────────────────────
    llama_model_params mparams = llama_model_default_params();
    // CPU-only; set n_gpu_layers > 0 for Metal / Vulkan offload.
    mparams.n_gpu_layers = 0;
    mparams.use_mmap     = true;  // memory-map the file for minimal RAM pressure
    mparams.use_mlock    = false; // do not lock pages on mobile (battery cost)

    model_ = llama_model_load_from_file(path.c_str(), mparams);
    if (!model_) {
        Object result(runtime);
        result.setProperty(runtime, "status", String::createFromUtf8(runtime, "failed"));
        result.setProperty(runtime, "error",  String::createFromUtf8(runtime, "llama_model_load_from_file returned null"));
        result.setProperty(runtime, "path",   String::createFromUtf8(runtime, path));
        return result;
    }

    // ── Context params ────────────────────────────────────────────────────────
    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx       = 4096;  // context window (tokens)
    cparams.n_batch     = 512;   // prompt-processing batch size
    cparams.n_ubatch    = 512;   // micro-batch size for decode
    cparams.n_threads   = std::max(1u, std::thread::hardware_concurrency() / 2);
    cparams.n_threads_batch = cparams.n_threads;
    cparams.flash_attn  = false; // disable Flash Attention on mobile by default

    ctx_ = llama_init_from_model(model_, cparams);
    if (!ctx_) {
        llama_model_free(model_);
        model_ = nullptr;

        Object result(runtime);
        result.setProperty(runtime, "status", String::createFromUtf8(runtime, "failed"));
        result.setProperty(runtime, "error",  String::createFromUtf8(runtime, "llama_init_from_model returned null"));
        result.setProperty(runtime, "path",   String::createFromUtf8(runtime, path));
        return result;
    }

    // ── Default sampler chain ─────────────────────────────────────────────────
    SamplerConfig defaultCfg;
    buildSamplerChain(defaultCfg);

    modelPath_ = path;
    isLoaded_  = true;
    stopRequested_.store(false);

    Object result(runtime);
    result.setProperty(runtime, "status",  String::createFromUtf8(runtime, "loaded"));
    result.setProperty(runtime, "path",    String::createFromUtf8(runtime, path));
    result.setProperty(runtime, "n_vocab", Value(static_cast<double>(llama_vocab_n_tokens(llama_model_get_vocab(model_)))));
    result.setProperty(runtime, "n_ctx",   Value(static_cast<double>(llama_n_ctx(ctx_))));
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// generate
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::generate(Runtime& runtime, const Value& promptVal, const Value& optionsVal) {
    if (!promptVal.isString()) {
        throw JSError(runtime, "[BitNet] generate: prompt must be a string");
    }

    std::lock_guard<std::mutex> lock(engineMutex_);

    if (!isLoaded_ || !model_ || !ctx_) {
        throw JSError(runtime, "[BitNet] generate: no model loaded — call loadModel() first");
    }

    const std::string prompt = promptVal.asString(runtime).utf8(runtime);
    const SamplerConfig cfg  = parseSamplerConfig(runtime, optionsVal);

    // Reset abort flag and rebuild sampler chain with request-specific params.
    stopRequested_.store(false);
    buildSamplerChain(cfg);
    llama_kv_cache_clear(ctx_);

    // ── Tokenise prompt ───────────────────────────────────────────────────────
    const llama_vocab* vocab = llama_model_get_vocab(model_);
    const int MAX_PROMPT_TOKENS = static_cast<int>(llama_n_ctx(ctx_)) - cfg.n_predict - 4;

    std::vector<llama_token> promptTokens(MAX_PROMPT_TOKENS + 4);
    int nPromptTokens = llama_tokenize(
        vocab,
        prompt.c_str(),
        static_cast<int32_t>(prompt.size()),
        promptTokens.data(),
        static_cast<int32_t>(promptTokens.size()),
        /* add_special= */ true,
        /* parse_special= */ true
    );
    if (nPromptTokens < 0) {
        throw JSError(runtime, "[BitNet] generate: tokenize failed — prompt may be too long");
    }
    promptTokens.resize(nPromptTokens);

    // ── Batch-process prompt ──────────────────────────────────────────────────
    llama_batch batch = llama_batch_init(
        static_cast<int32_t>(promptTokens.size()),
        /* embd= */   0,
        /* n_seq_max= */ 1
    );

    for (int i = 0; i < nPromptTokens; ++i) {
        llama_batch_add(batch, promptTokens[i], i, {0}, false);
    }
    // Request logits only for the last prompt token.
    batch.logits[batch.n_tokens - 1] = true;

    if (llama_decode(ctx_, batch) != 0) {
        llama_batch_free(batch);
        throw JSError(runtime, "[BitNet] generate: prompt decode failed");
    }

    // ── Token generation loop ─────────────────────────────────────────────────
    auto t_start = std::chrono::high_resolution_clock::now();

    std::string generatedText;
    generatedText.reserve(cfg.n_predict * 4);

    int nPast      = nPromptTokens;
    int nGenerated = 0;
    bool hitStop   = false;

    for (int i = 0; i < cfg.n_predict && !stopRequested_.load() && !hitStop; ++i) {
        // Sample next token using the chain (temperature → top_k → top_p → repeat_penalty → greedy).
        llama_token newToken = llama_sampler_sample(sampler_, ctx_, -1);

        // Check for end-of-generation tokens.
        if (llama_vocab_is_eog(vocab, newToken)) {
            break;
        }

        // Decode token to text piece.
        char tokenBuf[256] = {};
        int  pieceLen = llama_token_to_piece(vocab, newToken, tokenBuf, sizeof(tokenBuf) - 1, 0, true);
        if (pieceLen < 0) {
            pieceLen = 0;
        }
        tokenBuf[pieceLen] = '\0';
        generatedText.append(tokenBuf, pieceLen);
        ++nGenerated;

        // Check user-supplied stop sequences.
        for (const auto& stop : cfg.stop_sequences) {
            if (!stop.empty() &&
                generatedText.size() >= stop.size() &&
                generatedText.substr(generatedText.size() - stop.size()) == stop)
            {
                // Remove the trailing stop sequence from the output.
                generatedText.erase(generatedText.size() - stop.size());
                hitStop = true;
                break;
            }
        }
        if (hitStop) break;

        // Prepare single-token batch for the next step.
        llama_batch_clear(batch);
        llama_batch_add(batch, newToken, nPast++, {0}, true);

        if (llama_decode(ctx_, batch) != 0) {
            // Decode error — return whatever we have so far.
            break;
        }
    }

    llama_batch_free(batch);

    auto t_end = std::chrono::high_resolution_clock::now();
    const double elapsedMs = std::chrono::duration<double, std::milli>(t_end - t_start).count();
    const double tokensPerSec = (elapsedMs > 0.0 && nGenerated > 0)
        ? (nGenerated / (elapsedMs / 1000.0))
        : 0.0;

    // ── Memory stats ──────────────────────────────────────────────────────────
    const size_t kvBytes = llama_state_get_size(ctx_);
    const double kvMb    = static_cast<double>(kvBytes) / (1024.0 * 1024.0);

    // ── Build JS result object ────────────────────────────────────────────────
    Object result(runtime);
    result.setProperty(runtime, "text",             String::createFromUtf8(runtime, generatedText));
    result.setProperty(runtime, "tokens_per_second", Value(tokensPerSec));
    result.setProperty(runtime, "memory_used_mb",    Value(kvMb));
    result.setProperty(runtime, "n_tokens",          Value(static_cast<double>(nGenerated)));
    result.setProperty(runtime, "elapsed_ms",        Value(elapsedMs));
    result.setProperty(runtime, "stopped",           Value(stopRequested_.load() || hitStop));
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// stopGeneration
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::stopGeneration(Runtime& runtime) {
    stopRequested_.store(true);
    return Value::undefined();
}

// ─────────────────────────────────────────────────────────────────────────────
// unloadModel
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::unloadModel(Runtime& runtime) {
    {
        std::lock_guard<std::mutex> lock(engineMutex_);
        releaseEngine();
    }
    Object result(runtime);
    result.setProperty(runtime, "status", String::createFromUtf8(runtime, "unloaded"));
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// getModelInfo
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::getModelInfo(Runtime& runtime) {
    Object info(runtime);
    std::lock_guard<std::mutex> lock(engineMutex_);

    if (!isLoaded_ || !model_ || !ctx_) {
        info.setProperty(runtime, "is_loaded",  Value(false));
        info.setProperty(runtime, "model_path", String::createFromUtf8(runtime, ""));
        return info;
    }

    const llama_vocab* vocab = llama_model_get_vocab(model_);

    info.setProperty(runtime, "is_loaded",   Value(true));
    info.setProperty(runtime, "model_path",  String::createFromUtf8(runtime, modelPath_));
    info.setProperty(runtime, "n_vocab",     Value(static_cast<double>(llama_vocab_n_tokens(vocab))));
    info.setProperty(runtime, "n_ctx",       Value(static_cast<double>(llama_n_ctx(ctx_))));
    info.setProperty(runtime, "n_ctx_train", Value(static_cast<double>(llama_model_n_ctx_train(model_))));
    info.setProperty(runtime, "n_embd",      Value(static_cast<double>(llama_model_n_embd(model_))));
    info.setProperty(runtime, "n_layers",    Value(static_cast<double>(llama_model_n_layer(model_))));

    // Model description string (e.g. "LLaMA 7B Q4_K_M").
    char descBuf[256] = {};
    llama_model_desc(model_, descBuf, sizeof(descBuf));
    info.setProperty(runtime, "description", String::createFromUtf8(runtime, descBuf));

    return info;
}

// ─────────────────────────────────────────────────────────────────────────────
// getMemoryStats
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::getMemoryStats(Runtime& runtime) {
    Object stats(runtime);
    std::lock_guard<std::mutex> lock(engineMutex_);

    if (!ctx_) {
        stats.setProperty(runtime, "kv_cache_mb",    Value(0.0));
        stats.setProperty(runtime, "model_size_mb",  Value(0.0));
        return stats;
    }

    const size_t kvBytes    = llama_state_get_size(ctx_);
    const uint64_t modelBytes = llama_model_size(model_);

    stats.setProperty(runtime, "kv_cache_mb",   Value(static_cast<double>(kvBytes)    / (1024.0 * 1024.0)));
    stats.setProperty(runtime, "model_size_mb", Value(static_cast<double>(modelBytes) / (1024.0 * 1024.0)));
    return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// tokenize
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::tokenize(Runtime& runtime, const Value& textVal) {
    if (!textVal.isString()) {
        throw JSError(runtime, "[BitNet] tokenize: text must be a string");
    }
    std::lock_guard<std::mutex> lock(engineMutex_);
    if (!isLoaded_ || !model_) {
        throw JSError(runtime, "[BitNet] tokenize: no model loaded");
    }

    const std::string text = textVal.asString(runtime).utf8(runtime);
    const llama_vocab* vocab = llama_model_get_vocab(model_);
    std::vector<llama_token> toks(text.size() + 4);

    int n = llama_tokenize(
        vocab,
        text.c_str(),
        static_cast<int32_t>(text.size()),
        toks.data(),
        static_cast<int32_t>(toks.size()),
        true, true
    );
    if (n < 0) {
        throw JSError(runtime, "[BitNet] tokenize: internal tokenization error");
    }
    toks.resize(n);

    Array arr = Array(runtime, toks.size());
    for (size_t i = 0; i < toks.size(); ++i) {
        arr.setValueAtIndex(runtime, i, Value(static_cast<double>(toks[i])));
    }
    return arr;
}

// ─────────────────────────────────────────────────────────────────────────────
// detokenize
// ─────────────────────────────────────────────────────────────────────────────

Value BitNetJSI::detokenize(Runtime& runtime, const Value& tokensVal) {
    if (!tokensVal.isObject() || !tokensVal.asObject(runtime).isArray(runtime)) {
        throw JSError(runtime, "[BitNet] detokenize: argument must be an Array of token IDs");
    }
    std::lock_guard<std::mutex> lock(engineMutex_);
    if (!isLoaded_ || !model_) {
        throw JSError(runtime, "[BitNet] detokenize: no model loaded");
    }

    Array arr = tokensVal.asObject(runtime).asArray(runtime);
    const size_t len = arr.size(runtime);
    const llama_vocab* vocab = llama_model_get_vocab(model_);

    std::string result;
    result.reserve(len * 4);
    char buf[256] = {};

    for (size_t i = 0; i < len; ++i) {
        llama_token tok = static_cast<llama_token>(
            arr.getValueAtIndex(runtime, i).asNumber()
        );
        int pieceLen = llama_token_to_piece(vocab, tok, buf, sizeof(buf) - 1, 0, true);
        if (pieceLen > 0) {
            buf[pieceLen] = '\0';
            result.append(buf, pieceLen);
        }
    }

    return String::createFromUtf8(runtime, result);
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

void BitNetJSI::releaseEngine() {
    if (sampler_) {
        llama_sampler_free(sampler_);
        sampler_ = nullptr;
    }
    if (ctx_) {
        llama_free(ctx_);
        ctx_ = nullptr;
    }
    if (model_) {
        llama_model_free(model_);
        model_ = nullptr;
    }
    isLoaded_ = false;
    modelPath_.clear();
}

BitNetJSI::SamplerConfig BitNetJSI::parseSamplerConfig(
    Runtime& runtime,
    const Value& options)
{
    SamplerConfig cfg;
    if (options.isUndefined() || options.isNull() || !options.isObject()) {
        return cfg;
    }

    auto obj = options.asObject(runtime);
    auto readInt = [&](const char* key, int32_t& out) {
        Value v = obj.getProperty(runtime, key);
        if (v.isNumber()) out = static_cast<int32_t>(v.asNumber());
    };
    auto readFloat = [&](const char* key, float& out) {
        Value v = obj.getProperty(runtime, key);
        if (v.isNumber()) out = static_cast<float>(v.asNumber());
    };

    readInt  ("max_tokens",     cfg.n_predict);
    readFloat("temperature",    cfg.temperature);
    readFloat("top_p",          cfg.top_p);
    readInt  ("top_k",          cfg.top_k);
    readFloat("repeat_penalty", cfg.repeat_penalty);

    // Parse stop sequences if provided as array of strings.
    Value stopVal = obj.getProperty(runtime, "stop");
    if (stopVal.isObject() && stopVal.asObject(runtime).isArray(runtime)) {
        Array sa = stopVal.asObject(runtime).asArray(runtime);
        size_t n = sa.size(runtime);
        for (size_t i = 0; i < n; ++i) {
            Value sv = sa.getValueAtIndex(runtime, i);
            if (sv.isString()) {
                cfg.stop_sequences.push_back(sv.asString(runtime).utf8(runtime));
            }
        }
    }

    return cfg;
}

void BitNetJSI::buildSamplerChain(const SamplerConfig& cfg) {
    if (sampler_) {
        llama_sampler_free(sampler_);
        sampler_ = nullptr;
    }

    // Build chain: temp → top_k → top_p → repeat_penalty → greedy
    sampler_ = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(sampler_, llama_sampler_init_temp(cfg.temperature));
    llama_sampler_chain_add(sampler_, llama_sampler_init_top_k(cfg.top_k));
    llama_sampler_chain_add(sampler_, llama_sampler_init_top_p(cfg.top_p, 1));
    llama_sampler_chain_add(sampler_, llama_sampler_init_penalties(
        0,                  // last_n (0 = ctx size)
        cfg.repeat_penalty, // repeat
        0.0f,               // freq  (disabled)
        0.0f                // present (disabled)
    ));
    llama_sampler_chain_add(sampler_, llama_sampler_init_greedy());
}

} // namespace jsi
} // namespace facebook
