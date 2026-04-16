/**
 * Cosmo AI - Multi-Ecosystem LLM Backend Service
 * 
 * Supports multiple LLM ecosystems:
 * - Local GGUF (llama.cpp via llama.rn)
 * - Ollama (local server)
 * - OpenAI API
 * - Mistral API
 * - Anthropic Claude API
 * - HuggingFace Inference API
 * - Cosmo Server (Strategic Core)
 * 
 * References: ChatterUI, Maid app implementations
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSettingsForQuantization, SamplerSettings } from './samplerSettings';
import * as FileSystem from 'expo-file-system/legacy';
import { getModelsDirectory } from '@/utils/modelPaths';
import type { LlamaContext } from 'llama.rn';

// === TYPES ===

export type LLMBackendType = 'local' | 'ollama' | 'openai' | 'mistral' | 'anthropic' | 'huggingface' | 'cosmo_server' | 'self_learner' | 'gemini' | 'bitnet';

export interface LLMBackendConfig {
    type: LLMBackendType;
    name: string;
    enabled: boolean;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    // Local GGUF specific
    modelPath?: string;
    quantization?: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface CompletionRequest {
    messages: ChatMessage[];
    systemPrompt?: string;
    useRag?: boolean;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
    samplerSettings?: Partial<SamplerSettings>;
    nsfwMode?: boolean;
    roleplayMode?: boolean;
    preferAirLLM?: boolean;
}

export interface CompletionResponse {
    content: string;
    model: string;
    backend: LLMBackendType;
    tokensUsed?: number;
    finishReason?: string;
}

// === DEFAULT CONFIGURATIONS ===

const DEFAULT_BACKENDS: Record<LLMBackendType, Partial<LLMBackendConfig>> = {
    local: {
        type: 'local',
        name: 'Local GGUF (On-Device)',
        enabled: false,
    },
    ollama: {
        type: 'ollama',
        name: 'Ollama (Local Server)',
        enabled: false,
        baseUrl: 'http://localhost:11434',
    },
    openai: {
        type: 'openai',
        name: 'OpenAI',
        enabled: false,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
    },
    mistral: {
        type: 'mistral',
        name: 'Mistral AI',
        enabled: false,
        baseUrl: 'https://api.mistral.ai/v1',
        model: 'mistral-small-latest',
    },
    anthropic: {
        type: 'anthropic',
        name: 'Anthropic Claude',
        enabled: false,
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-3-haiku-20240307',
    },
    huggingface: {
        type: 'huggingface',
        name: 'HuggingFace Inference',
        enabled: false,
        baseUrl: 'https://api-inference.huggingface.co',
        model: 'meta-llama/Llama-3.2-3B-Instruct',
    },
    cosmo_server: {
        type: 'cosmo_server',
        name: 'Cosmo AI Server',
        enabled: true,
        baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-cosmo-ai.hf.space',
    },
    self_learner: {
        type: 'self_learner',
        name: 'Cosmo Self-Learner',
        enabled: true,
        baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-cosmo-ai.hf.space',
        model: 'cosmo-micro-transformer',
    },
    gemini: {
        type: 'gemini',
        name: 'Google Gemini',
        enabled: false,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-2.5-flash',
    },
    bitnet: {
        type: 'bitnet',
        name: 'BitNet.cpp (ARM Native)',
        enabled: true,
        model: 'cosmo-1.58bit-ternary.bitnet',
    },
};

// === LLM BACKEND SERVICE ===

class LLMBackendService {
    private backends: Map<LLMBackendType, LLMBackendConfig> = new Map();
    private currentBackend: LLMBackendType = 'cosmo_server';
    private localContext: LlamaContext | null = null;
    private currentLocalModelPath: string | null = null;

    constructor() {
        this.initializeDefaults();
        this.loadConfigs();
    }

    private initializeDefaults(): void {
        for (const [type, config] of Object.entries(DEFAULT_BACKENDS)) {
            this.backends.set(type as LLMBackendType, {
                ...config,
                enabled: config.enabled ?? false,
            } as LLMBackendConfig);
        }
    }

    async loadConfigs(): Promise<void> {
        try {
            const saved = await AsyncStorage.getItem('llm_backend_configs');
            if (saved) {
                const configs = JSON.parse(saved) as Record<string, LLMBackendConfig>;
                for (const [type, config] of Object.entries(configs)) {
                    this.backends.set(type as LLMBackendType, config);
                }
            }
            const savedBackend = await AsyncStorage.getItem('llm_current_backend');
            if (savedBackend) {
                this.currentBackend = savedBackend as LLMBackendType;
            }
        } catch (error) {
            console.error('Failed to load LLM backend configs:', error);
        }
    }

    async saveConfigs(): Promise<void> {
        try {
            const configs: Record<string, LLMBackendConfig> = {};
            for (const [type, config] of this.backends.entries()) {
                configs[type] = { ...config, apiKey: config.apiKey ? '***' : undefined };
            }
            await AsyncStorage.setItem('llm_backend_configs', JSON.stringify(configs));
            await AsyncStorage.setItem('llm_current_backend', this.currentBackend);
        } catch (error) {
            console.error('Failed to save LLM backend configs:', error);
        }
    }

    getBackends(): LLMBackendConfig[] {
        return Array.from(this.backends.values());
    }

    getCurrentBackend(): LLMBackendType {
        return this.currentBackend;
    }

    getCurrentBackendType(): LLMBackendType {
        return this.currentBackend;
    }

    /**
     * Legacy alias for complete() used by some hooks
     */
    async completionWithFallback(request: CompletionRequest): Promise<CompletionResponse> {
        return this.complete(request);
    }

    async setCurrentBackend(type: LLMBackendType): Promise<void> {
        if (!this.backends.has(type)) throw new Error(`Unknown backend: ${type}`);
        this.currentBackend = type;
        await this.saveConfigs();
    }

    getCurrentLocalModelPath(): string | null {
        const local = this.backends.get('local');
        return local?.modelPath || null;
    }

    async updateBackend(type: LLMBackendType, config: Partial<LLMBackendConfig>): Promise<void> {
        const existing = this.backends.get(type);
        if (!existing) throw new Error(`Unknown backend: ${type}`);
        this.backends.set(type, { ...existing, ...config });
        await this.saveConfigs();
    }

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const backend = this.backends.get(this.currentBackend);
        if (!backend) throw new Error(`Backend not configured: ${this.currentBackend}`);

        switch (this.currentBackend) {
            case 'local': return this.completeLocal(request, backend);
            case 'ollama': return this.completeOllama(request, backend);
            case 'openai': return this.completeOpenAI(request, backend);
            case 'mistral': return this.completeMistral(request, backend);
            case 'anthropic': return this.completeAnthropic(request, backend);
            case 'huggingface': return this.completeHuggingFace(request, backend);
            case 'cosmo_server': return this.completeCosmoServer(request, backend);
            case 'self_learner': return this.completeSelfLearner(request, backend);
            case 'gemini': return this.completeGemini(request, backend);
            case 'bitnet': return this.completeBitNet(request, backend);
            default: throw new Error(`Unsupported backend: ${this.currentBackend}`);
        }
    }

    async initializeBackend(type: LLMBackendType = 'local'): Promise<void> {
        const backend = this.backends.get(type);
        if (!backend) throw new Error(`Backend not configured: ${type}`);

        if (type === 'local') {
            try {
                const { initLlama } = await import('llama.rn');
                if (this.localContext && this.currentLocalModelPath === backend.modelPath) return;
                if (this.localContext && this.currentLocalModelPath !== backend.modelPath) {
                    await this.localContext.release();
                    this.localContext = null;
                }
                if (!backend.modelPath) throw new Error('No local model loaded.');

                let modelPath = backend.modelPath;
                if (modelPath.startsWith('file://')) modelPath = modelPath.replace('file://', '');

                const modelPathForCheck = modelPath.startsWith('file://') ? modelPath : `file://${modelPath}`;
                const fileInfo = await FileSystem.getInfoAsync(modelPathForCheck);
                if (!fileInfo.exists) {
                    this.localContext = null;
                    return;
                }

                const samplerSettings = backend.quantization ? getSettingsForQuantization(backend.quantization) : undefined;
                const initProfiles = this.buildLocalInitProfiles(samplerSettings);
                let lastInitError: unknown = null;

                for (const profile of initProfiles) {
                    try {
                        this.localContext = await initLlama({
                            model: modelPath,
                            n_ctx: profile.n_ctx,
                            n_batch: profile.n_batch,
                            n_threads: profile.n_threads,
                        });
                        this.currentLocalModelPath = backend.modelPath;
                        return;
                    } catch (profileError) {
                        lastInitError = profileError;
                    }
                }
                throw lastInitError instanceof Error ? lastInitError : new Error('Failed to initialize local model');
            } catch (error) {
                console.error('Failed to initialize local model:', error);
                this.localContext = null;
            }
        }
    }

    private buildLocalInitProfiles(samplerSettings?: SamplerSettings) {
        const baseCtx = samplerSettings?.n_ctx ?? 2048;
        const baseBatch = samplerSettings?.n_batch ?? 512;
        const baseThreads = samplerSettings?.n_threads ?? 4;
        return [
            { n_ctx: baseCtx, n_batch: Math.min(baseBatch, 512), n_threads: baseThreads },
            { n_ctx: Math.min(baseCtx, 1536), n_batch: Math.min(baseBatch, 128), n_threads: Math.min(baseThreads, 2) },
        ];
    }

    private async completeLocal(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        await this.initializeBackend('local');
        if (!this.localContext) throw new Error('Local model context not initialized');

        let prompt = request.systemPrompt ? `System: ${request.systemPrompt}\n\n` : '';
        prompt += request.messages.map(m => `${m.role.charAt(0).toUpperCase() + m.role.slice(1)}: ${m.content}`).join('\n') + '\nAssistant:';

        const result = await this.localContext.completion({
            prompt,
            n_predict: request.maxTokens ?? 512,
            temperature: request.temperature ?? 0.7,
            penalty_repeat: 1.1,
            stop: ['User:', 'System:', '<|im_end|>', '</s>'],
        });

        return { content: result.text, model: config.modelPath || 'local', backend: 'local', finishReason: 'stop' };
    }

    private async completeOllama(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        const messages = request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }, ...request.messages] : request.messages;
        const response = await fetch(`${config.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: config.model ?? 'llama2', messages, stream: false, options: { temperature: request.temperature ?? 0.7, num_predict: request.maxTokens ?? 512 } }),
        });
        if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);
        const data = await response.json();
        return { content: data.message.content, model: config.model ?? 'ollama', backend: 'ollama' };
    }

    private async completeOpenAI(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        if (!config.apiKey) throw new Error('OpenAI API key not configured');
        const messages = request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }, ...request.messages] : request.messages;
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
            body: JSON.stringify({ model: config.model ?? 'gpt-4o-mini', messages, max_tokens: request.maxTokens ?? 512, temperature: request.temperature ?? 0.7 }),
        });
        if (!response.ok) throw new Error(`OpenAI error: ${response.statusText}`);
        const data = await response.json();
        return { content: data.choices[0].message.content, model: data.model, backend: 'openai', tokensUsed: data.usage?.total_tokens };
    }

    private async completeMistral(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        if (!config.apiKey) throw new Error('Mistral API key not configured');
        const messages = request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }, ...request.messages] : request.messages;
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
            body: JSON.stringify({ model: config.model ?? 'mistral-small-latest', messages, max_tokens: request.maxTokens ?? 512, temperature: request.temperature ?? 0.7 }),
        });
        if (!response.ok) throw new Error(`Mistral error: ${response.statusText}`);
        const data = await response.json();
        return { content: data.choices[0].message.content, model: data.model, backend: 'mistral', tokensUsed: data.usage?.total_tokens };
    }

    private async completeAnthropic(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        if (!config.apiKey) throw new Error('Anthropic API key not configured');
        const response = await fetch(`${config.baseUrl}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: config.model ?? 'claude-3-haiku-20240307', max_tokens: request.maxTokens ?? 512, system: request.systemPrompt, messages: request.messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })) }),
        });
        if (!response.ok) throw new Error(`Anthropic error: ${response.statusText}`);
        const data = await response.json();
        return { content: data.content[0].text, model: data.model, backend: 'anthropic', tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens };
    }

    private async completeHuggingFace(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        const prompt = this.formatMessagesForLocal(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }, ...request.messages] : request.messages);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
        const response = await fetch(`${config.baseUrl}/models/${config.model}`, { method: 'POST', headers, body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: request.maxTokens ?? 512, temperature: request.temperature ?? 0.7 } }) });
        if (!response.ok) throw new Error(`HuggingFace error: ${response.statusText}`);
        const data = await response.json();
        return { content: Array.isArray(data) ? data[0].generated_text : data.generated_text, model: config.model ?? 'huggingface', backend: 'huggingface' };
    }

    private async completeCosmoServer(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        const response = await fetch(`${config.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: request.messages[request.messages.length - 1]?.content ?? '',
                history: request.messages.slice(0, -1),
                system_prompt: request.systemPrompt,
                use_rag: request.useRag ?? true,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 512,
                nsfw_mode: request.nsfwMode ?? false,
                roleplay_mode: request.roleplayMode ?? false,
                prefer_airllm: request.preferAirLLM ?? false,
            }),
        });
        if (!response.ok) throw new Error(`Cosmo server error: ${response.statusText}`);
        const data = await response.json();
        return { content: data.response ?? data.message ?? '', model: 'Cosmo-server', backend: 'cosmo_server' };
    }

    private async completeSelfLearner(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        const response = await fetch(`${config.baseUrl}/api/chat/self-learner`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: request.messages[request.messages.length - 1]?.content ?? '',
                history: request.messages.slice(0, -1),
                use_rag: request.useRag ?? true,
                system_prompt: request.systemPrompt,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 512,
                is_local: true,
                nsfw_mode: request.nsfwMode ?? false,
                roleplay_mode: request.roleplayMode ?? false,
            }),
        });
        if (!response.ok) throw new Error(`Self-learner error: ${response.statusText}`);
        const data = await response.json();
        return { content: data.response ?? data.message ?? '', model: data.model_used ?? config.model ?? 'cosmo-micro-transformer', backend: 'self_learner', tokensUsed: data.tokens_used };
    }

    private async completeGemini(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        if (!config.apiKey) throw new Error('Gemini API key not configured');
        const model = config.model || 'gemini-2.5-flash';
        const url = `${config.baseUrl}/models/${model}:generateContent?key=${config.apiKey}`;
        const contents = request.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents, systemInstruction: request.systemPrompt ? { parts: [{ text: request.systemPrompt }] } : undefined, generationConfig: { maxOutputTokens: request.maxTokens ?? 512, temperature: request.temperature ?? 0.7 } }),
        });
        if (!response.ok) throw new Error(`Gemini error: ${response.statusText}`);
        const data = await response.json();
        return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || '', model, backend: 'gemini', finishReason: data.candidates?.[0]?.finishReason };
    }
    
    private async completeBitNet(request: CompletionRequest, config: LLMBackendConfig): Promise<CompletionResponse> {
        const { nativeBitNet } = await import('./NativeBitNet');

        // Ensure the JSI bridge is installed.
        nativeBitNet.install();

        // Check hardware support safely.
        const supported = nativeBitNet.isHardwareSupported();
        if (!supported) {
            throw new Error('[BitNet] ARM acceleration (NEON/ASIMD) is not available on this device');
        }

        // Lazy-load model if not already active or path changed.
        if (config.modelPath && config.modelPath !== nativeBitNet.currentModelPath) {
            const loaded = await nativeBitNet.loadModel(config.modelPath);
            if (!loaded) {
                throw new Error(`[BitNet] Failed to load native model: ${config.modelPath}`);
            }
        }

        const prompt = this.formatMessagesForLocal(request.messages);
        const result = await nativeBitNet.generate(prompt, {
            max_tokens:     request.maxTokens  ?? 512,
            temperature:    request.temperature ?? 0.7,
            top_p:          0.9,
            top_k:          40,
            repeat_penalty: 1.1,
            stop: ['<|im_end|>', '</s>', '[/INST]', 'User:', 'System:'],
        });

        return {
            content:    result.text,
            model:      config.model || 'bitnet-native',
            backend:    'bitnet',
            tokensUsed: result.n_tokens,
        };
    }

    async *stream(request: CompletionRequest, abortSignal?: AbortSignal): AsyncGenerator<string> {
        const backend = this.backends.get(this.currentBackend);
        if (!backend) throw new Error(`Backend not configured: ${this.currentBackend}`);
        try {
            switch (this.currentBackend) {
                case 'cosmo_server': yield* this.streamCosmoServer(request, backend, abortSignal); break;
                case 'openai': yield* this.streamOpenAI(request, backend, abortSignal); break;
                case 'ollama': yield* this.streamOllama(request, backend, abortSignal); break;
                case 'mistral': yield* this.streamMistral(request, backend, abortSignal); break;
                case 'anthropic': yield* this.streamAnthropic(request, backend, abortSignal); break;
                case 'huggingface': yield* this.streamHuggingFace(request, backend, abortSignal); break;
                case 'self_learner': { const res = await this.completeSelfLearner(request, backend); yield res.content; } break;
                case 'gemini': yield* this.streamGemini(request, backend, abortSignal); break;
                case 'local': { const res = await this.completeLocal(request, backend); yield res.content; } break;
                default: throw new Error(`Streaming not supported for: ${this.currentBackend}`);
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return;
            throw error;
        }
    }

    private async *streamCosmoServer(request: CompletionRequest, config: LLMBackendConfig, abortSignal?: AbortSignal): AsyncGenerator<string> {
        const isHeavyModel = (config.model?.includes('70b') || config.model?.includes('405b'));
        const response = await fetch(`${config.baseUrl}/api/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: request.messages[request.messages.length - 1]?.content ?? '',
                history: request.messages.slice(0, -1),
                system_prompt: request.systemPrompt,
                use_rag: request.useRag ?? true,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 512,
                nsfw_mode: request.nsfwMode ?? false,
                roleplay_mode: request.roleplayMode ?? false,
                stream: true,
                prefer_airllm: request.preferAirLLM || isHeavyModel,
            }),
            signal: abortSignal,
        });
        if (!response.ok) throw new Error(`Cosmo stream error: ${response.statusText}`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.token) yield parsed.token;
                        else if (parsed.response) yield parsed.response;
                    } catch { if (data) yield data; }
                }
            }
        }
    }

    private async *streamOpenAI(request: CompletionRequest, config: LLMBackendConfig, abortSignal?: AbortSignal): AsyncGenerator<string> {
        if (!config.apiKey) throw new Error('API key missing');
        const messages = request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }, ...request.messages] : request.messages;
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
            body: JSON.stringify({ model: config.model ?? 'gpt-4o-mini', messages, max_tokens: request.maxTokens ?? 512, temperature: request.temperature ?? 0.7, stream: true }),
            signal: abortSignal,
        });
        if (!response.ok) throw new Error(`OpenAI error: ${response.statusText}`);
        const reader = response.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    try { const parsed = JSON.parse(data); const content = parsed.choices?.[0]?.delta?.content; if (content) yield content; } catch {}
                }
            }
        }
    }

    private async *streamOllama(request: CompletionRequest, config: LLMBackendConfig, abortSignal?: AbortSignal): AsyncGenerator<string> {
        const messages = request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }, ...request.messages] : request.messages;
        const response = await fetch(`${config.baseUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model ?? 'llama2', messages, stream: true }), signal: abortSignal });
        if (!response.ok) throw new Error('Ollama error');
        const reader = response.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                try { const parsed = JSON.parse(line); if (parsed.message?.content) yield parsed.message.content; } catch {}
            }
        }
    }

    private async *streamMistral(request: CompletionRequest, config: LLMBackendConfig, abortSignal?: AbortSignal): AsyncGenerator<string> {
        yield* this.streamOpenAI(request, config, abortSignal);
    }

    private async *streamAnthropic(request: CompletionRequest, config: LLMBackendConfig, abortSignal?: AbortSignal): AsyncGenerator<string> {
        if (!config.apiKey) throw new Error('API key missing');
        const response = await fetch(`${config.baseUrl}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: config.model ?? 'claude-3-haiku-20240307', max_tokens: request.maxTokens ?? 512, system: request.systemPrompt, messages: request.messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })), stream: true }),
            signal: abortSignal,
        });
        const reader = response.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    try { const parsed = JSON.parse(data); if (parsed.type === 'content_block_delta') yield parsed.delta.text; } catch {}
                }
            }
        }
    }

    private async *streamHuggingFace(request: CompletionRequest, config: LLMBackendConfig, abortSignal?: AbortSignal): AsyncGenerator<string> {
        const res = await this.completeHuggingFace(request, config);
        yield res.content;
    }

    private async *streamGemini(request: CompletionRequest, config: LLMBackendConfig, abortSignal?: AbortSignal): AsyncGenerator<string> {
        const res = await this.completeGemini(request, config);
        yield res.content;
    }

    private formatMessagesForLocal(messages: ChatMessage[]): string {
        let prompt = '<|begin_of_text|>';
        for (const m of messages) {
            prompt += `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`;
        }
        prompt += '<|start_header_id|>assistant<|end_header_id|>\n\n';
        return prompt;
    }

    async checkBackendAvailable(type: LLMBackendType): Promise<boolean> {
        const config = this.backends.get(type);
        if (!config) return false;
        try {
            switch (type) {
                case 'local': return true;
                case 'ollama': const r = await fetch(`${config.baseUrl}/api/version`); return r.ok;
                case 'cosmo_server': const c = await fetch(`${config.baseUrl}/api/health`); return c.ok;
                case 'self_learner': const s = await fetch(`${config.baseUrl}/api/chat/self-learner/status`); return s.ok;
                default: return !!config.apiKey;
            }
        } catch { return false; }
    }
}

export const llmBackend = new LLMBackendService();
export default llmBackend;
