#pragma once

#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <memory>
#include <string>
#include <vector>
#include <atomic>
#include <mutex>
#include <functional>

// llama.cpp C API — resolved at link time via llama.rn native library
#include "llama.h"

namespace facebook {
namespace jsi {

/**
 * Cosmo AI - BitNet JSI Bridge
 * =============================
 * Synchronous JSI HostObject wrapping the llama.cpp C inference engine.
 * Binds to global.cosmoBitNet and provides sub-1ms JSI call overhead.
 *
 * Threading model:
 *   - JSI calls arrive on the JS thread.
 *   - Inference (generate) is dispatched to a dedicated C++ worker thread
 *     and the result is returned synchronously via a condition_variable wait.
 *     This keeps the JS thread responsive without async bridge overhead.
 */
class JSI_EXPORT BitNetJSI : public HostObject {
public:
    BitNetJSI(
        Runtime& runtime,
        std::shared_ptr<facebook::react::CallInvoker> jsCallInvoker
    );

    virtual ~BitNetJSI();

    // ── HostObject interface ──────────────────────────────────────────────────
    Value get(Runtime& runtime, const PropNameID& name) override;
    void set(Runtime& runtime, const PropNameID& name, const Value& value) override;
    std::vector<PropNameID> getPropertyNames(Runtime& runtime) override;

    // ── Public API (called from JSI get() dispatch) ───────────────────────────

    /**
     * loadModel(path: string, options?: object) → { status: 'loaded'|'failed', path: string }
     *
     * Loads a GGUF model from the given file-system path.
     * Initialises llama_model, llama_context, llama_sampler chain.
     */
    Value loadModel(Runtime& runtime, const Value& path, const Value& options);

    /**
     * generate(prompt: string, options?: object) → { text, tokens_per_second, memory_used_mb, n_tokens }
     *
     * Runs a synchronous completion on the loaded model.
     * Uses a background thread for the decode loop; waits via condition_variable.
     */
    Value generate(Runtime& runtime, const Value& prompt, const Value& options);

    /**
     * stopGeneration() → void
     * Signals the inference loop to abort the current generation.
     */
    Value stopGeneration(Runtime& runtime);

    /**
     * unloadModel() → { status: 'unloaded' }
     * Frees model, context, sampler and all associated GGML tensors.
     */
    Value unloadModel(Runtime& runtime);

    /**
     * getModelInfo() → { n_vocab, n_ctx, n_embd, model_path, is_loaded }
     * Returns metadata about the currently loaded model.
     */
    Value getModelInfo(Runtime& runtime);

    /**
     * getMemoryStats() → { total_mem_bytes, used_mem_bytes, kv_cache_mb }
     * Returns live memory consumption from llama_context.
     */
    Value getMemoryStats(Runtime& runtime);

    /**
     * tokenize(text: string) → number[]
     * Tokenizes text using the model's vocabulary.
     */
    Value tokenize(Runtime& runtime, const Value& text);

    /**
     * detokenize(tokens: number[]) → string
     * Converts an array of token IDs back to text.
     */
    Value detokenize(Runtime& runtime, const Value& tokens);

private:
    // ── Engine state ──────────────────────────────────────────────────────────
    struct llama_model*   model_   = nullptr;
    struct llama_context* ctx_     = nullptr;
    struct llama_sampler* sampler_ = nullptr;

    std::string modelPath_;
    bool        isLoaded_  = false;

    // ── Concurrency ───────────────────────────────────────────────────────────
    mutable std::mutex                engineMutex_;
    std::atomic<bool>                 stopRequested_{false};
    std::shared_ptr<facebook::react::CallInvoker> jsCallInvoker_;

    // ── Internal helpers ──────────────────────────────────────────────────────
    void releaseEngine();

    /**
     * High-level sampling config parsed from JS options object.
     */
    struct SamplerConfig {
        int32_t n_predict   = 512;
        float   temperature = 0.7f;
        float   top_p       = 0.9f;
        int32_t top_k       = 40;
        float   repeat_penalty = 1.1f;
        std::vector<std::string> stop_sequences;
    };

    SamplerConfig parseSamplerConfig(Runtime& runtime, const Value& options);

    /**
     * Builds and resets the llama_sampler chain with the given config.
     */
    void buildSamplerChain(const SamplerConfig& cfg);
};

} // namespace jsi
} // namespace facebook
