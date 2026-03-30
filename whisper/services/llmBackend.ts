/**
 * Whisper AI - Multi-Ecosystem LLM Backend Service
 * 
 * Supports multiple LLM ecosystems:
 * - Local GGUF (llama.cpp via llama.rn)
 * - Ollama (local server)
 * - OpenAI API
 * - Mistral API
 * - Anthropic Claude API
 * - HuggingFace Inference API
 * 
 * References: ChatterUI, Maid app implementations
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSettingsForQuantization, SamplerSettings } from './samplerSettings';
import * as FileSystem from 'expo-file-system/legacy';
import { getModelsDirectory } from '@/utils/modelPaths';



// === TYPES ===

export type LLMBackendType = 'local' | 'ollama' | 'openai' | 'mistral' | 'anthropic' | 'huggingface' | 'Whisper_server' | 'self_learner' | 'gemini';

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
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
    samplerSettings?: Partial<SamplerSettings>;
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
        enabled: false, // Disabled by default - user must download models first
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
    Whisper_server: {
        type: 'Whisper_server',
        name: 'Whisper AI Server',
        enabled: true,
        baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-whisper-ai.hf.space',
    },
    self_learner: {
        type: 'self_learner',
        name: 'Whisper Self-Learner',
        enabled: true,
        baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-whisper-ai.hf.space',
        model: 'whisper-micro-transformer',
    },
    gemini: {
        type: 'gemini',
        name: 'Google Gemini',
        enabled: false,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-2.5-flash',
    },
};

// === LLM BACKEND SERVICE ===

class LLMBackendService {
    private backends: Map<LLMBackendType, LLMBackendConfig> = new Map();
    private currentBackend: LLMBackendType = 'Whisper_server';
    private localContext: any = null; // llama.rn context
    private currentLocalModelPath: string | null = null;

    constructor() {
        this.initializeDefaults();
    }

    private initializeDefaults(): void {
        for (const [type, config] of Object.entries(DEFAULT_BACKENDS)) {
            this.backends.set(type as LLMBackendType, {
                ...config,
                enabled: config.enabled ?? false,
            } as LLMBackendConfig);
        }
    }

    /**
     * Load saved backend configurations
     */
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

    /**
     * Save backend configurations
     */
    async saveConfigs(): Promise<void> {
        try {
            const configs: Record<string, LLMBackendConfig> = {};
            for (const [type, config] of this.backends.entries()) {
                // Don't save API keys in plain text - they should be in secure storage
                configs[type] = { ...config, apiKey: config.apiKey ? '***' : undefined };
            }
            await AsyncStorage.setItem('llm_backend_configs', JSON.stringify(configs));
            await AsyncStorage.setItem('llm_current_backend', this.currentBackend);
        } catch (error) {
            console.error('Failed to save LLM backend configs:', error);
        }
    }

    /**
     * Get all backend configurations
     */
    getBackends(): LLMBackendConfig[] {
        return Array.from(this.backends.values());
    }

    /**
     * Get current backend
     */
    getCurrentBackend(): LLMBackendType {
        return this.currentBackend;
    }

    /**
     * Set current backend
     */
    async setCurrentBackend(type: LLMBackendType): Promise<void> {
        if (!this.backends.has(type)) {
            throw new Error(`Unknown backend: ${type}`);
        }
        this.currentBackend = type;
        await this.saveConfigs();
    }

    /**
     * Update backend configuration
     */
    async updateBackend(type: LLMBackendType, config: Partial<LLMBackendConfig>): Promise<void> {
        const existing = this.backends.get(type);
        if (!existing) {
            throw new Error(`Unknown backend: ${type}`);
        }
        this.backends.set(type, { ...existing, ...config });
        await this.saveConfigs();
    }

    /**
     * Complete chat using current backend
     */
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const backend = this.backends.get(this.currentBackend);
        if (!backend) {
            throw new Error(`Backend not configured: ${this.currentBackend}`);
        }

        switch (this.currentBackend) {
            case 'local':
                return this.completeLocal(request, backend);
            case 'ollama':
                return this.completeOllama(request, backend);
            case 'openai':
                return this.completeOpenAI(request, backend);
            case 'mistral':
                return this.completeMistral(request, backend);
            case 'anthropic':
                return this.completeAnthropic(request, backend);
            case 'huggingface':
                return this.completeHuggingFace(request, backend);
            case 'Whisper_server':
                return this.completeWhisperServer(request, backend);
            case 'self_learner':
                return this.completeSelfLearner(request, backend);
            case 'gemini':
                return this.completeGemini(request, backend);
            default:
                throw new Error(`Unsupported backend: ${this.currentBackend}`);
        }
    }


    /**
     * Initialize the current backend (warm-up)
     * For local models, this loads the model into memory.
     */
    async initializeBackend(type: LLMBackendType = 'local'): Promise<void> {
        const backend = this.backends.get(type);
        if (!backend) {
            throw new Error(`Backend not configured: ${type}`);
        }

        if (type === 'local') {
            try {
                const { initLlama } = await import('llama.rn');

                // If already loaded and path matches, do nothing
                if (this.localContext && this.currentLocalModelPath === backend.modelPath) {
                    console.log('Local model already initialized');
                    return;
                }

                // If loaded but path different, release
                if (this.localContext && this.currentLocalModelPath !== backend.modelPath) {
                    console.log('Switching local models, releasing previous context...');
                    await this.localContext.release();
                    this.localContext = null;
                }

                if (!backend.modelPath) {
                    throw new Error('No local model loaded. Download a model first.');
                }

                // Sanitization
                let modelPath = backend.modelPath;
                if (modelPath.startsWith('file://')) {
                    modelPath = modelPath.replace('file://', '');
                }

                // Debug: Log the paths for verification
                console.log('🔍 Model initialization paths:');
                console.log('  - Model path from config:', modelPath);
                console.log('  - Models directory (runtime):', getModelsDirectory());
                console.log('  - Full resolved path:', modelPath);

                // Verification - FileSystem.getInfoAsync needs file:// protocol
                const modelPathForCheck = modelPath.startsWith('file://') ? modelPath : `file://${modelPath}`;
                const fileInfo = await FileSystem.getInfoAsync(modelPathForCheck);
                if (!fileInfo.exists) {
                    const errorMsg = `Model file not found at: ${modelPath}`;
                    console.error(errorMsg);
                    // Don't throw - just log and return gracefully
                    // This prevents the app from crashing when models aren't downloaded yet
                    this.localContext = null;
                    this.currentLocalModelPath = null;
                    return; // Exit gracefully
                }

                // Init
                const samplerSettings = backend.quantization
                    ? getSettingsForQuantization(backend.quantization)
                    : undefined;

                console.log(`Initializing local model: ${modelPath}`);
                this.localContext = await initLlama({
                    model: modelPath,
                    n_ctx: samplerSettings?.n_ctx ?? 2048,
                    n_batch: samplerSettings?.n_batch ?? 512,
                    n_threads: samplerSettings?.n_threads ?? 4,
                });
                this.currentLocalModelPath = backend.modelPath;
                console.log('Local model initialized successfully');

            } catch (error) {
                console.error('Failed to initialize local model:', error);
                // Don't re-throw to prevent error loops
                this.localContext = null;
                this.currentLocalModelPath = null;
                // Only log the error, don't crash the app
            }
        }
    }

    private async completeLocal(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        // Ensure initialized
        await this.initializeBackend('local');

        if (!this.localContext) {
            throw new Error('Local model context not initialized');
        }

        // Construct simple prompt with system message if available
        let prompt = '';
        if (request.systemPrompt) {
            prompt += `System: ${request.systemPrompt}\n\n`;
        }

        prompt += request.messages.map(m => {
            const roleMap: Record<string, string> = {
                user: 'User',
                system: 'System',
                assistant: 'Assistant'
            };
            return `${roleMap[m.role] || 'User'}: ${m.content}`;
        }).join('\n') + '\nAssistant:';

        try {
            const result = await this.localContext.completion({
                prompt,
                n_predict: request.maxTokens ?? 512,
                temperature: request.temperature ?? 0.7,
                stop: ['User:', 'System:'],
            });

            return {
                content: result.text,
                model: config.modelPath || 'local',
                backend: 'local',
                finishReason: 'stop'
            };
        } catch (e) {
            console.error('Local completion failed:', e);
            throw e;
        }
    }

    getCurrentBackendType(): LLMBackendType {
        return this.currentBackend;
    }

    /**
     * Complete chat with fallback mechanism
     * Tries the requested backend first, then falls back to others if it fails/timeouts
     */
    async completionWithFallback(
        request: CompletionRequest,
        timeoutMs: number = 120000
    ): Promise<CompletionResponse> {
        // Priority order for fallbacks
        const priority: LLMBackendType[] = ['local', 'self_learner', 'Whisper_server', 'gemini', 'openai', 'mistral', 'anthropic'];

        // Ensure current backend is tried first
        const tryOrder = [
            this.currentBackend,
            ...priority.filter(b => b !== this.currentBackend)
        ];

        let lastError: any;

        for (const backendType of tryOrder) {
            const backend = this.backends.get(backendType);
            // Skip disabled or unconfigured backends
            if (!backend || !backend.enabled) continue;
            // Skip configured but missing key (except local/server which might not need key)
            if (!backend.apiKey && !['local', 'Whisper_server', 'self_learner', 'ollama'].includes(backendType)) continue;

            try {
                // Temporarily switch backend context for this request if needed?
                // Actually complete() uses this.currentBackend, so we need a way to force a backend in complete
                // Refactoring complete to accept backend overrides or calling specific methods directly

                // For now, let's call specific internal methods based on type to avoid changing global state
                // Only if we expose those methods or refactor complete to take 'backendType' arg

                console.log(`Trying backend: ${backendType}...`);
                const response = await this.completeWithTimeout(request, backendType, timeoutMs);
                return response;
            } catch (error) {
                console.warn(`Backend ${backendType} failed:`, error);
                lastError = error;
                // Continue to next backend
            }
        }

        throw lastError || new Error('All enabled backends failed');
    }

    private async completeWithTimeout(
        request: CompletionRequest,
        type: LLMBackendType,
        timeoutMs: number
    ): Promise<CompletionResponse> {
        const backend = this.backends.get(type);
        if (!backend) throw new Error(`Backend ${type} not found`);

        const completePromise = (async () => {
            switch (type) {
                case 'local': return this.completeLocal(request, backend);
                case 'ollama': return this.completeOllama(request, backend);
                case 'openai': return this.completeOpenAI(request, backend);
                case 'mistral': return this.completeMistral(request, backend);
                case 'anthropic': return this.completeAnthropic(request, backend);
                case 'huggingface': return this.completeHuggingFace(request, backend);
                case 'Whisper_server': return this.completeWhisperServer(request, backend);
                case 'self_learner': return this.completeSelfLearner(request, backend);
                case 'gemini': return this.completeGemini(request, backend);
                default: throw new Error(`Unknown backend ${type}`);
            }
        })();

        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        );

        return Promise.race([completePromise, timeoutPromise]);
    }

    getCurrentLocalModelPath(): string | null {
        return this.currentLocalModelPath;
    }

    /**
     * Stream chat completion
     * Implements Server-Sent Events (SSE) streaming for real-time responses
     */
    async *stream(request: CompletionRequest, abortSignal?: AbortSignal): AsyncGenerator<string> {
        const backend = this.backends.get(this.currentBackend);
        if (!backend) {
            throw new Error(`Backend not configured: ${this.currentBackend}`);
        }

        try {
            switch (this.currentBackend) {
                case 'Whisper_server':
                    yield* this.streamWhisperServer(request, backend, abortSignal);
                    break;
                case 'openai':
                    yield* this.streamOpenAI(request, backend, abortSignal);
                    break;
                case 'ollama':
                    yield* this.streamOllama(request, backend, abortSignal);
                    break;
                case 'mistral':
                    yield* this.streamMistral(request, backend, abortSignal);
                    break;
                case 'anthropic':
                    yield* this.streamAnthropic(request, backend, abortSignal);
                    break;
                case 'huggingface':
                    yield* this.streamHuggingFace(request, backend, abortSignal);
                    break;
                case 'self_learner':
                    {
                        const response = await this.completeSelfLearner(request, backend);
                        yield response.content;
                    }
                    break;
                case 'gemini':
                    yield* this.streamGemini(request, backend, abortSignal);
                    break;
                case 'local':
                    // Local GGUF doesn't support streaming yet, fallback to complete
                    const response = await this.completeLocal(request, backend);
                    yield response.content;
                    break;
                default:
                    throw new Error(`Streaming not supported for backend: ${this.currentBackend}`);
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('Stream aborted by user');
                return;
            }
            throw error;
        }
    }

    /**
     * Stream request using XMLHttpRequest (React Native compatible)
     */
    private async *streamWithXHR(
        url: string,
        method: string,
        headers: any,
        body: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        let xhr = new XMLHttpRequest();
        let seenBytes = 0;
        const queue: string[] = [];
        let resolveQueue: ((val?: any) => void) | null = null;
        let finished = false;
        let error: any = null;

        xhr.open(method, url);
        for (const key in headers) {
            xhr.setRequestHeader(key, headers[key]);
        }

        xhr.onreadystatechange = () => {
            if (xhr.readyState === 3 || xhr.readyState === 4) {
                const newData = xhr.responseText.substring(seenBytes);
                if (newData.length > 0) {
                    seenBytes = xhr.responseText.length;
                    queue.push(newData);
                    if (resolveQueue) {
                        resolveQueue();
                        resolveQueue = null;
                    }
                }
            }
            if (xhr.readyState === 4) {
                finished = true;
                if (resolveQueue) {
                    resolveQueue();
                    resolveQueue = null;
                }
            }
        };

        xhr.onerror = () => {
            error = new Error('Network request failed');
            finished = true;
            if (resolveQueue) {
                resolveQueue();
                resolveQueue = null;
            }
        };

        if (abortSignal) {
            abortSignal.onabort = () => {
                xhr.abort();
                finished = true;
                if (resolveQueue) {
                    resolveQueue();
                    resolveQueue = null;
                }
            };
        }

        xhr.send(body);

        while (!finished || queue.length > 0) {
            if (queue.length > 0) {
                yield queue.shift()!;
            } else {
                if (finished) break;
                if (error) throw error;
                await new Promise<void>(resolve => resolveQueue = resolve);
            }
        }

        if (error) throw error;
    }

    /**
     * SSE Parser Utility
     * Parses Server-Sent Events from a streaming response
     */
    private async *parseSSE(response: Response, abortSignal?: AbortSignal): AsyncGenerator<string> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Response body is not readable');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                // Check if aborted
                if (abortSignal?.aborted) {
                    reader.cancel();
                    throw new DOMException('Aborted', 'AbortError');
                }

                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') continue;
                        if (data) yield data;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Stream from Whisper AI Server
     */
    private async *streamWhisperServer(
        request: CompletionRequest,
        config: LLMBackendConfig,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        const stream = this.streamWithXHR(
            `${config.baseUrl}/api/chat/stream`,
            'POST',
            { 'Content-Type': 'application/json' },
            JSON.stringify({
                message: request.messages[request.messages.length - 1]?.content ?? '',
                system_prompt: request.systemPrompt,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 512,
                stream: true,
            }),
            abortSignal
        );

        let buffer = '';
        for await (const chunk of stream) {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.token) {
                            yield parsed.token;
                        } else if (parsed.response) {
                            yield parsed.response;
                        }
                    } catch {
                        // If not JSON, yield as-is (legacy compatibility)
                        if (data) yield data;
                    }
                }
            }
        }
    }

    /**
     * Stream from OpenAI
     */
    private async *streamOpenAI(
        request: CompletionRequest,
        config: LLMBackendConfig,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        if (!config.apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const messages = request.systemPrompt
            ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
            : request.messages;

        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model ?? 'gpt-4o-mini',
                messages,
                max_tokens: request.maxTokens ?? 512,
                temperature: request.temperature ?? 0.7,
                stream: true,
            }),
            signal: abortSignal,
        });

        if (!response.ok) {
            throw new Error(`OpenAI error: ${response.statusText}`);
        }

        for await (const data of this.parseSSE(response, abortSignal)) {
            try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) yield content;
            } catch {
                // Skip malformed chunks
            }
        }
    }

    /**
     * Stream from Ollama
     */
    private async *streamOllama(
        request: CompletionRequest,
        config: LLMBackendConfig,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        const messages = request.systemPrompt
            ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
            : request.messages;

        const response = await fetch(`${config.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model ?? 'llama2',
                messages,
                stream: true,
                options: {
                    temperature: request.temperature ?? 0.7,
                    num_predict: request.maxTokens ?? 512,
                },
            }),
            signal: abortSignal,
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body is not readable');

        const decoder = new TextDecoder();
        try {
            while (true) {
                if (abortSignal?.aborted) {
                    reader.cancel();
                    throw new DOMException('Aborted', 'AbortError');
                }

                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message?.content) {
                            yield parsed.message.content;
                        }
                    } catch {
                        // Skip malformed lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Stream from Mistral
     */
    private async *streamMistral(
        request: CompletionRequest,
        config: LLMBackendConfig,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        if (!config.apiKey) {
            throw new Error('Mistral API key not configured');
        }

        const messages = request.systemPrompt
            ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
            : request.messages;

        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model ?? 'mistral-small-latest',
                messages,
                max_tokens: request.maxTokens ?? 512,
                temperature: request.temperature ?? 0.7,
                stream: true,
            }),
            signal: abortSignal,
        });

        if (!response.ok) {
            throw new Error(`Mistral error: ${response.statusText}`);
        }

        for await (const data of this.parseSSE(response, abortSignal)) {
            try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) yield content;
            } catch {
                // Skip malformed chunks
            }
        }
    }

    /**
     * Stream from Anthropic Claude
     */
    private async *streamAnthropic(
        request: CompletionRequest,
        config: LLMBackendConfig,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        if (!config.apiKey) {
            throw new Error('Anthropic API key not configured');
        }

        const response = await fetch(`${config.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: config.model ?? 'claude-3-haiku-20240307',
                max_tokens: request.maxTokens ?? 512,
                system: request.systemPrompt,
                messages: request.messages.map(m => ({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content,
                })),
                stream: true,
            }),
            signal: abortSignal,
        });

        if (!response.ok) {
            throw new Error(`Anthropic error: ${response.statusText}`);
        }

        for await (const data of this.parseSSE(response, abortSignal)) {
            try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                    yield parsed.delta.text;
                }
            } catch {
                // Skip malformed chunks
            }
        }
    }

    /**
     * Stream from HuggingFace
     * Note: Not all HF models support streaming, falls back to complete() if needed
     */
    private async *streamHuggingFace(
        request: CompletionRequest,
        config: LLMBackendConfig,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        // HuggingFace Inference API doesn't reliably support streaming
        // Fall back to non-streaming for now
        const response = await this.completeHuggingFace(request, config);
        yield response.content;
    }


    // === BACKEND IMPLEMENTATIONS ===

    /**
     * Local GGUF backend (llama.rn)
     */


    /**
     * Ollama backend
     */
    private async completeOllama(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        const messages = request.systemPrompt
            ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
            : request.messages;

        const response = await fetch(`${config.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model ?? 'llama2',
                messages,
                stream: false,
                options: {
                    temperature: request.temperature ?? 0.7,
                    num_predict: request.maxTokens ?? 512,
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            content: data.message.content,
            model: config.model ?? 'ollama',
            backend: 'ollama',
        };
    }

    /**
     * OpenAI backend
     */
    private async completeOpenAI(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        if (!config.apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const messages = request.systemPrompt
            ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
            : request.messages;

        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model ?? 'gpt-4o-mini',
                messages,
                max_tokens: request.maxTokens ?? 512,
                temperature: request.temperature ?? 0.7,
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenAI error: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            content: data.choices[0].message.content,
            model: data.model,
            backend: 'openai',
            tokensUsed: data.usage?.total_tokens,
        };
    }

    /**
     * Mistral backend
     */
    private async completeMistral(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        if (!config.apiKey) {
            throw new Error('Mistral API key not configured');
        }

        const messages = request.systemPrompt
            ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
            : request.messages;

        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model ?? 'mistral-small-latest',
                messages,
                max_tokens: request.maxTokens ?? 512,
                temperature: request.temperature ?? 0.7,
            }),
        });

        if (!response.ok) {
            throw new Error(`Mistral error: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            content: data.choices[0].message.content,
            model: data.model,
            backend: 'mistral',
            tokensUsed: data.usage?.total_tokens,
        };
    }

    /**
     * Anthropic Claude backend
     */
    private async completeAnthropic(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        if (!config.apiKey) {
            throw new Error('Anthropic API key not configured');
        }

        const response = await fetch(`${config.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: config.model ?? 'claude-3-haiku-20240307',
                max_tokens: request.maxTokens ?? 512,
                system: request.systemPrompt,
                messages: request.messages.map(m => ({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content,
                })),
            }),
        });

        if (!response.ok) {
            throw new Error(`Anthropic error: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            content: data.content[0].text,
            model: data.model,
            backend: 'anthropic',
            tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens,
        };
    }

    /**
     * HuggingFace Inference backend
     */
    private async completeHuggingFace(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        const prompt = this.formatMessagesForLocal(
            request.systemPrompt
                ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
                : request.messages
        );

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.apiKey) {
            headers['Authorization'] = `Bearer ${config.apiKey}`;
        }

        const response = await fetch(
            `${config.baseUrl}/models/${config.model}`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    inputs: prompt,
                    parameters: {
                        max_new_tokens: request.maxTokens ?? 512,
                        temperature: request.temperature ?? 0.7,
                    },
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`HuggingFace error: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            content: Array.isArray(data) ? data[0].generated_text : data.generated_text,
            model: config.model ?? 'huggingface',
            backend: 'huggingface',
        };
    }

    /**
     * Whisper AI Server backend
     */
    private async completeWhisperServer(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        const response = await fetch(`${config.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: request.messages[request.messages.length - 1]?.content ?? '',
                system_prompt: request.systemPrompt,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 512,
            }),
        });

        if (!response.ok) {
            throw new Error(`Whisper server error: ${response.statusText}`);
        }

        const data = await response.json();

        return {
            content: data.response ?? data.message ?? '',
            model: 'Whisper-server',
            backend: 'Whisper_server',
        };
    }

    /**
     * Whisper scratch-built transformer running on the server.
     */
    private async completeSelfLearner(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        const response = await fetch(`${config.baseUrl}/api/chat/self-learner`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: request.messages[request.messages.length - 1]?.content ?? '',
                history: request.messages.slice(0, -1),
                system_prompt: request.systemPrompt,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 512,
                is_local: true,
            }),
        });

        if (!response.ok) {
            throw new Error(`Self-learner error: ${response.statusText}`);
        }

        const data = await response.json();

        return {
            content: data.response ?? data.message ?? '',
            model: data.model_used ?? config.model ?? 'whisper-micro-transformer',
            backend: 'self_learner',
            tokensUsed: data.tokens_used,
        };
    }

    /**
     * Gemini backend
     */
    private async completeGemini(
        request: CompletionRequest,
        config: LLMBackendConfig
    ): Promise<CompletionResponse> {
        if (!config.apiKey) {
            throw new Error('Gemini API key not configured');
        }

        const model = config.model || 'gemini-2.5-flash';
        const url = `${config.baseUrl}/models/${model}:generateContent?key=${config.apiKey}`;

        const contents = [];

        for (const m of request.messages) {
            contents.push({
                role: m.role === 'assistant' ? 'model' : 'user', // Gemini uses 'model' instead of 'assistant'
                parts: [{ text: m.content }]
            });
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents,
                systemInstruction: request.systemPrompt
                    ? {
                        parts: [{ text: request.systemPrompt }],
                    }
                    : undefined,
                generationConfig: {
                    maxOutputTokens: request.maxTokens ?? 512,
                    temperature: request.temperature ?? 0.7,
                }
            }),
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Gemini error: ${response.statusText} - ${errBody}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return {
            content: text,
            model: model,
            backend: 'gemini',
            finishReason: data.candidates?.[0]?.finishReason
        };
    }

    /**
     * Stream from Gemini
     */
    private async *streamGemini(
        request: CompletionRequest,
        config: LLMBackendConfig,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        if (!config.apiKey) {
            throw new Error('Gemini API key not configured');
        }

        const model = config.model || 'gemini-2.5-flash';
        // streamGenerateContent
        const url = `${config.baseUrl}/models/${model}:streamGenerateContent?key=${config.apiKey}`;

        const contents = [];

        for (const m of request.messages) {
            contents.push({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }]
            });
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents,
                systemInstruction: request.systemPrompt
                    ? {
                        parts: [{ text: request.systemPrompt }],
                    }
                    : undefined,
                generationConfig: {
                    maxOutputTokens: request.maxTokens ?? 512,
                    temperature: request.temperature ?? 0.7,
                }
            }),
            signal: abortSignal
        });

        if (!response.ok) {
            throw new Error(`Gemini stream error: ${response.statusText}`);
        }

        // Gemini streaming returns a JSON array, but in chunks.
        // Actually, streamGenerateContent returns a stream of JSON objects, not SSE.
        // Each chunk is a complete JSON object like { candidates: [...] }
        // BUT, standard fetch stream reader reads bytes. Usually Gemini API returns strictly valid JSON objects separated by comma or in array?
        // Actually it returns standard SSE-like behavior? No, it's a "server-sent events" style BUT usually via REST it might be one huge JSON array or chunked JSON.
        // Let's assume standard response text chunking and valid JSON objects per line?
        // documentation says: "The response is a stream of GenerateContentResponse objects."
        // Format: [{...}, {...}] ? or just {...}\n{...}?
        // Usually strictly valid JSON list [ ... ]

        // Let's use a simpler approach: 
        // We will read the stream, accumulate text, and try to parse "candidates".
        // HOWEVER, to keep it robust and simple for now, we'll wait for full buffer OR try to find balanced braces.

        // REVISION: The simplest way for React Native fetch to handle this custom stream format is tricky.
        // Let's assume we can parse chunks.

        // Actually, for simplicity and stability as fallback, let's just use NON-streaming for Gemini first, 
        // OR implement a basic parser.
        // Let's implement basic parsing assuming it sends complete JSON objects in chunks.

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body is not readable');

        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                if (abortSignal?.aborted) {
                    reader.cancel();
                    break;
                }
                const { value, done } = await reader.read();
                if (done) break;

                const text = decoder.decode(value, { stream: true });
                buffer += text;

                // Naive parsing: Clean up buffer, look for "text" field
                // Gemini stream format is actually: [{ "candidates": [...] }, \n { "candidates": [...] }]
                // It starts with '[' and ends with ']'
                // We can strip '[' and ']' and split by ','? 

                // Let's try to extract "text" by regex to be safe against JSON formatting issues
                const regex = /"text":\s*"([^"]*)"/g; // This is risky with escaped quotes.

                // Better: find balanced JSON objects? 
                // Let's just yield the full text if we can find it.
                // Let's fallback to standard 'complete' behavior if streaming is too complex without a library?
                // No, I'll attempt to parse valid JSON objects.

            }
        } finally {
            reader.releaseLock();
        }

        // RE-PLAN: Use non-streaming implementation for streamGemini for now to avoid breaking.
        const res = await this.completeGemini(request, config);
        yield res.content;
    }

    /**
     * Format messages for local llama.cpp format
     */
    private formatMessagesForLocal(messages: ChatMessage[]): string {
        // Use Llama 3 format
        let prompt = '<|begin_of_text|>';

        for (const message of messages) {
            if (message.role === 'system') {
                prompt += `<|start_header_id|>system<|end_header_id|>\n\n${message.content}<|eot_id|>`;
            } else if (message.role === 'user') {
                prompt += `<|start_header_id|>user<|end_header_id|>\n\n${message.content}<|eot_id|>`;
            } else if (message.role === 'assistant') {
                prompt += `<|start_header_id|>assistant<|end_header_id|>\n\n${message.content}<|eot_id|>`;
            }
        }

        prompt += '<|start_header_id|>assistant<|end_header_id|>\n\n';
        return prompt;
    }

    /**
     * Check if backend is available
     */
    async checkBackendAvailable(type: LLMBackendType): Promise<boolean> {
        const config = this.backends.get(type);
        if (!config) return false;

        try {
            switch (type) {
                case 'local':
                    // Check if llama.rn is available
                    await import('llama.rn');
                    return true;

                case 'ollama':
                    const ollamaResp = await fetch(`${config.baseUrl}/api/version`, {
                        method: 'GET',
                        signal: AbortSignal.timeout(5000),
                    });
                    return ollamaResp.ok;

                case 'openai':
                case 'mistral':
                case 'anthropic':
                    // These require API keys
                    return !!config.apiKey;

                case 'huggingface':
                    return true; // Free tier available

                case 'Whisper_server':
                    const WhisperResp = await fetch(`${config.baseUrl}/api/health`, {
                        method: 'GET',
                        signal: AbortSignal.timeout(5000),
                    });
                    return WhisperResp.ok;

                case 'self_learner':
                    const selfLearnerResp = await fetch(`${config.baseUrl}/api/chat/self-learner/status`, {
                        method: 'GET',
                        signal: AbortSignal.timeout(5000),
                    });
                    return selfLearnerResp.ok;

                case 'gemini':
                    return !!config.apiKey;

                default:
                    return false;
            }
        } catch {
            return false;
        }
    }
}

export const llmBackend = new LLMBackendService();
export default llmBackend;
