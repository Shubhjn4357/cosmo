/**
 * Cosmo AI - API Service
 * Handles all communication with the Cosmo AI backend
 */

// Configure API base URL - update this to your server address
// Expo requires EXPO_PUBLIC_ prefix for env vars
const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-cosmo-ai.hf.space';
export interface ChatResponse {
    response: string;
    tokens_used: number;
    sources: { source: string }[];
    image_url?: string;
    multimodal?: {
        image_attached?: boolean;
        image_generated?: boolean;
        vision_matches?: { text?: string; score?: number; similarity?: number }[];
        vision_method?: string;
    };
}

export interface ImageResponse {
    image_url: string;
    seed: number;
    prompt: string;
}

export interface FileReadResponse {
    content: string;
    file_type: string;
    pages?: number;
    word_count: number;
    characters: number;
    ocr_model_id?: string;
    ocr_backend?: string;
}

export interface FileAnalyzeResponse {
    answer: string;
    relevant_text: string;
}

export interface SearchResult {
    text: string;
    score: number;
    source: string;
}

export interface HealthStatus {
    status: string;
    service?: string;
    model_loaded: boolean;
    tokenizer_loaded: boolean;
    vectordb_loaded: boolean;
    knowledge_chunks?: number;
    is_training: boolean;
    daemon_running: boolean;
    backend?: string;
}

export interface LLMModel {
    id: string;
    name: string;
    description: string;
    size_mb: number;
    ram_required_gb: number;
    speed: string;
    repo_id: string;
    filename: string;
    quantization: string;
    provider: string;
    download_url: string;
    downloadable?: boolean;
    recommended?: boolean;
    adult?: boolean;
    supports_local?: boolean;
    supports_server?: boolean;
    roles?: string[];
    auto_bootstrap?: boolean;
    resolved_endpoint?: string;
    endpoint_available?: boolean;
    endpoint_reachable?: boolean;
    endpoint_config_source?: string;
    artifact_path?: string;
    downloaded?: boolean;
    install_status?: string;
    install_error?: string | null;
    size_bytes?: number;
    kind?: string;
    tags?: string[];
}

export interface ImageModel {
    id: string;
    name: string;
    description?: string;
    provider?: string;
    generation_mode?: string;
    download_url?: string;
    downloadable?: boolean;
    recommended?: boolean;
    adult?: boolean;
    supports_local?: boolean;
    supports_server?: boolean;
    supports_text_prompt?: boolean;
    auto_bootstrap?: boolean;
    artifact_path?: string;
    downloaded?: boolean;
    install_status?: string;
    install_error?: string | null;
    tags?: string[];
    size_mb?: number;
    ram_required_gb?: number;
    speed?: string;
    type?: string;
    count?: number;
    performance?: number;
    queued?: number;
    eta?: number;
    filename?: string;
    repo_id?: string;
}

export interface OCRModel {
    id: string;
    name: string;
    description: string;
    provider: string;
    repo_id?: string;
    filename?: string;
    size_mb?: number;
    speed?: string;
    download_url?: string;
    recommended?: boolean;
    supports_local?: boolean;
    supports_server?: boolean;
    auto_bootstrap?: boolean;
    gated?: boolean;
    endpoint_env?: string;
    resolved_endpoint?: string;
    endpoint_available?: boolean;
    endpoint_reachable?: boolean;
    endpoint_config_source?: string;
    tags?: string[];
    artifact_path?: string;
    downloaded?: boolean;
    install_status?: string;
    install_error?: string | null;
    size_bytes?: number;
    kind?: string;
}

export interface SpeechModel {
    id: string;
    name: string;
    description: string;
    provider: string;
    repo_id?: string;
    capabilities?: string[];
    filename?: string;
    size_mb?: number;
    speed?: string;
    download_url?: string;
    recommended?: boolean;
    supports_local?: boolean;
    supports_server?: boolean;
    auto_bootstrap?: boolean;
    gated?: boolean;
    endpoint_env?: string;
    resolved_endpoint?: string;
    endpoint_available?: boolean;
    endpoint_reachable?: boolean;
    endpoint_config_source?: string;
    voice_family?: string;
    tags?: string[];
    artifact_path?: string;
    downloaded?: boolean;
    install_status?: string;
    install_error?: string | null;
    size_bytes?: number;
    kind?: string;
}

    audio?: string;
    audio_format?: string;
metadata ?: Record<string, string | number | boolean>;
}

export interface ChatHistoryItem {
    role: 'user' | 'assistant' | 'system';
    content: string;
    text?: string;
    isUser?: boolean;
}

export interface BaseStatusResponse {
    status: string;
    message?: string;
}

export interface AgentSessionDetail {
    session_id: string;
    status: string;
    goal: string;
    answer: string;
    plan: AgentPlanStep[];
    tool_results: AgentToolResult[];
}

export interface TrainingPair {
    input: string;
    output: string;
    model: string;
}

export interface AgentPlanStep {
    id: string;
    tool: string;
    goal: string;
    reason?: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    output_preview?: string;
}

export interface AgentToolResult {
    tool: string;
    summary: string;
    context?: string;
    sources?: { source: string; score?: number; chunk?: number }[];
    image_url?: string | null;
    answer?: string;
}

export interface AgentRunResponse {
    session_id: string;
    status: string;
    backend: string;
    goal: string;
    answer: string;
    image_url?: string | null;
    plan: AgentPlanStep[];
    tool_results: AgentToolResult[];
    citations: { source: string; score?: number; chunk?: number }[];
    updated_at?: number;
}

export class CosmoAPI {
    private baseUrl: string;

    constructor(baseUrl: string = API_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    setBaseUrl(url: string) {
        this.baseUrl = url;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    private getHeaders(): HeadersInit {
        return {
            'Content-Type': 'application/json',
            // Add any other default headers here, e.g., Authorization
        };
    }

    private getAdminHeaders(adminToken?: string): HeadersInit {
        if (!adminToken) {
            return this.getHeaders();
        }

        return {
            ...this.getHeaders(),
            Authorization: `Bearer ${adminToken}`,
        };
    }

    /**
     * Get optimal chat endpoint based on mode
     * - If smart mode enabled -> /api/chat/smart (provider racing)
     * - Else -> /api/chat (Cosmo server runtime)
     */
    private getOptimalEndpoint(smartMode: boolean = false): string {
        return smartMode ? '/api/chat/smart' : '/api/chat';
    }

    /**
     * Send a chat message and get a response
     */
    async chat(params: {
        message: string;
        history?: ChatHistoryItem[];
        context?: string;
        useRAG?: boolean;
        temperature?: number;
        maxTokens?: number;
        systemPrompt?: string;
        nsfwMode?: boolean;
        roleplayMode?: boolean;
        // Token system parameters
        isLocal?: boolean;  // FREE if true
        userId?: string;
        sessionId?: string;
        smartMode?: boolean;  // NEW: Use smart mode (races all APIs)
    }): Promise<ChatResponse> {
        // Determine endpoint: Smart mode or default (AI Horde)
        const endpoint = this.getOptimalEndpoint(params.smartMode || false);

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                message: params.message,
                history: params.history || [],
                context: params.context,
                use_rag: params.useRAG !== false,
                temperature: params.temperature || 0.8,
                max_tokens: params.maxTokens || 256,
                system_prompt: params.systemPrompt,
                nsfw_mode: params.nsfwMode || false,
                roleplay_mode: params.roleplayMode || false,
                is_local: params.isLocal !== false,
                user_id: params.userId,
                session_id: params.sessionId,
                conversation_history: params.history?.map(h => ({
                    text: h.text || h.content,
                    isUser: h.isUser || h.role === 'user'
                })),
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            // Check if insufficient tokens
            if (error.detail?.error === 'insufficient_tokens') {
                throw new Error(`Not enough tokens: ${error.detail.message}`);
            }
            throw new Error(`Chat failed: ${response.statusText}`);
        }

        const initialData = await response.json();

        // Check if this is an async task (Horde)
        if (initialData.task_id) {
            return this.pollTask(initialData.task_id);
        }

        return {
            response: initialData.response ?? initialData.message ?? '',
            tokens_used: initialData.tokens_used ?? 0,
            sources: initialData.sources ?? [],
        };
    }

    async chatSelfLearner(params: {
        message: string;
        history?: ChatHistoryItem[];
        context?: string;
        useRAG?: boolean;
        temperature?: number;
        maxTokens?: number;
        systemPrompt?: string;
        nsfwMode?: boolean;
        roleplayMode?: boolean;
        userId?: string;
        sessionId?: string;
        imageDataUrl?: string;
        imageUrl?: string;
        generateImage?: boolean;
    }): Promise<ChatResponse> {
        const response = await fetch(`${this.baseUrl}/api/chat/self-learner`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                message: params.message,
                history: params.history || [],
                context: params.context,
                use_rag: params.useRAG !== false,
                temperature: params.temperature || 0.7,
                max_tokens: params.maxTokens || 256,
                system_prompt: params.systemPrompt,
                nsfw_mode: params.nsfwMode || false,
                roleplay_mode: params.roleplayMode || false,
                is_local: true,
                user_id: params.userId,
                session_id: params.sessionId,
                image_data_url: params.imageDataUrl,
                image_url: params.imageUrl,
                generate_image: params.generateImage || false,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail?.message || error.detail || `Self-learner chat failed: ${response.statusText}`);
        }

        return response.json();
    }

    async runAgent(params: {
        message: string;
        history?: { role: string; content: string }[];
        sessionId?: string;
        context?: string;
        systemPrompt?: string;
        useRAG?: boolean;
        nsfwMode?: boolean;
        roleplayMode?: boolean;
        backend?: 'server' | 'self_learner' | 'cloud';
        allowResearch?: boolean;
        allowImages?: boolean;
        maxTokens?: number;
        userId?: string;
        waitForCompletion?: boolean;
    }): Promise<AgentRunResponse> {
        const response = await fetch(`${this.baseUrl}/api/agent/run`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                message: params.message,
                history: params.history || [],
                session_id: params.sessionId,
                context: params.context,
                system_prompt: params.systemPrompt,
                use_rag: params.useRAG !== false,
                nsfw_mode: params.nsfwMode || false,
                roleplay_mode: params.roleplayMode || false,
                backend: params.backend || 'server',
                allow_research: params.allowResearch !== false,
                allow_images: params.allowImages !== false,
                max_steps: params.maxSteps || 4,
                max_tokens: params.maxTokens || 320,
                user_id: params.userId,
                wait_for_completion: params.waitForCompletion || false,
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Agent run failed: ${response.statusText}`);
        }

        return response.json();
    }

    async getAgentSession(sessionId: string): Promise<AgentSessionDetail> {
        const response = await fetch(`${this.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch agent session: ${response.status}`);
        }
        return response.json();
    }

    async cancelAgentSession(sessionId: string): Promise<BaseStatusResponse> {
        const response = await fetch(`${this.baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/cancel`, {
            method: 'POST',
            headers: this.getHeaders(),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Failed to cancel agent session: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Poll a task until completion
     */
    private async pollTask(taskId: string, intervalMs: number = 2000, maxAttempts: number = 60): Promise<ChatResponse> {
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));

            try {
                const response = await fetch(`${this.baseUrl}/api/horde/tasks/${taskId}`);
                if (!response.ok) continue;

                const status = await response.json();

                if (status.status === 'completed') {
                    // Map Horde result to ChatResponse
                    return {
                        response: status.result?.response || status.result || "I couldn't generate a response.",
                        tokens_used: status.result?.tokens_used || 0,
                        sources: []
                    };
                }

                if (status.status === 'failed') {
                    throw new Error(status.error || 'Generation failed');
                }

                // Continue polling if 'queued' or 'processing'
            } catch (e) {
                console.error('Polling error:', e);
            }
        }
        throw new Error('Timeout waiting for response');
    }

    /**
     * Stream chat response using SSE
     */
    async *chatStream(
        message: string,
        options: { useRag?: boolean; temperature?: number; history?: { role: string; content: string }[] } = {}
    ): AsyncGenerator<string> {
        const response = await fetch(`${this.baseUrl}/api/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                use_rag: options.useRag ?? true,
                temperature: options.temperature ?? 0.8,
                history: options.history,
            }),
        });

        if (!response.ok) {
            throw new Error(`Stream failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) return;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') return;
                    yield data;
                }
            }
        }
    }

    /**
     * Generate an image from a text prompt
     */
    async generateImage(params: {
        prompt: string;
        negativePrompt?: string;
        width?: number;
        height?: number;
        numSteps?: number;
        guidanceScale?: number;
        modelId?: string;
        // Token system parameters
        isLocal?: boolean;  // FREE if true, costs 2.0 tokens if false
        userId?: string;
        sessionId?: string;
    }): Promise<ImageResponse> {
        const response = await fetch(`${this.baseUrl}/api/image/generate`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                prompt: params.prompt,
                negative_prompt: params.negativePrompt,
                width: params.width || 512,
                height: params.height || 512,
                num_steps: params.numSteps || 20,
                guidance_scale: params.guidanceScale || 7.5,
                model_id: params.modelId || 'cyberrealistic-v9',
                // Token params
                is_local: params.isLocal !== false,
                user_id: params.userId,
                session_id: params.sessionId,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            if (error.detail?.error === 'insufficient_tokens') {
                throw new Error(`Not enough tokens: ${error.detail.message}`);
            }
            throw new Error(`Image generation failed: ${response.statusText}`);
        }

        const data = await response.json();
        // Convert relative URL to absolute
        data.image_url = `${this.baseUrl}${data.image_url}`;
        return data;
    }

    /**
     * Transcribe audio to text
     */
    async transcribeAudio(params: {
        audioUri: string;
        language?: string;
        userId?: string;
        sessionId?: string;
    }): Promise<{ text: string; language: string }> {
        const formData = new FormData();
        formData.append('audio', ({
            uri: params.audioUri,
            name: 'recording.wav',
            type: 'audio/wav',
        } as unknown) as Blob);

        if (params.language) {
            formData.append('language', params.language);
        }
        if (params.userId) {
            formData.append('user_id', params.userId);
        }
        if (params.sessionId) {
            formData.append('session_id', params.sessionId);
        }

        const response = await fetch(`${this.baseUrl}/api/voice/transcribe`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Transcription failed: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Text to speech - convert text to audio
     */
    async textToSpeech(params: {
        text: string;
        voice?: string;
        userId?: string;
        sessionId?: string;
    }): Promise<{ audio_url: string }> {
        const response = await fetch(`${this.baseUrl}/api/voice/tts`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                text: params.text,
                voice: params.voice || 'default',
                user_id: params.userId,
                session_id: params.sessionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`TTS failed: ${response.statusText}`);
        }

        const data = await response.json();
        // Make URL absolute
        if (data.audio_url && !data.audio_url.startsWith('http')) {
            data.audio_url = `${this.baseUrl}${data.audio_url}`;
        }
        return data;
    }

    /**
     * Generate image using vision decoder (micro-transformer with learning)
     * Uses patterns learned from collected data
     */
    async generateVisionImage(params: {
        prompt: string;
        use_pretrained?: boolean;  // If true, uses AI Horde. If false, uses learned model
        userId?: string;
        sessionId?: string;
    }): Promise<{
        method: string;
        message?: string;
        prompt: string;
        generated_image?: string;
        knowledge_base_size?: number;
        note?: string;
    }> {
        const url = `${this.baseUrl}/api/feed/vision/generate?prompt=${encodeURIComponent(params.prompt)}&use_pretrained=${params.use_pretrained !== false}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                user_id: params.userId,
                session_id: params.sessionId
            })
        });

        if (!response.ok) {
            throw new Error(`Vision generation failed: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Get vision learning stats - see how much the AI has learned
     */
    async getVisionStats(): Promise<{
        storage: {
            total_images: number;
            max_capacity: number;
            embedding_dimension: number;
        };
        model: {
            vision_memories: number;
            unique_concepts: number;
            embedding_dimension: number;
        };
        capabilities: {
            can_learn: boolean;
            can_generate: boolean;
            generation_method: string;
        };
    }> {
        const response = await fetch(`${this.baseUrl}/api/feed/vision/stats`, {
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`Failed to get vision stats: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Read and extract text from a file
     */
    async readFile(file: {
        uri: string;
        name: string;
        type?: string;
    }, options: {
        ocrModelId?: string;
    } = {}): Promise<FileReadResponse> {
        const formData = new FormData();
        formData.append('file', ({
            uri: file.uri,
            name: file.name,
            type: file.type || 'application/octet-stream',
        } as unknown) as Blob);
        if (options?.ocrModelId) {
            formData.append('ocr_model_id', options.ocrModelId);
        }

        const response = await fetch(`${this.baseUrl}/api/files/read`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`File read failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * HuggingFace Dataset Sync APIs
     */

    /**
     * Manually trigger HuggingFace sync
     */
    async syncToHuggingFace(): Promise<{ status: string; message: string; repo: string }> {
        const response = await fetch(`${this.baseUrl}/api/learn/sync-now`, {
            method: 'POST',
            headers: this.getHeaders(),
        });

        if (!response.ok) {
            throw new Error(`HuggingFace sync failed: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Download latest dataset from HuggingFace
     */
    async downloadFromHuggingFace(): Promise<{ status: string; count: number; repo: string }> {
        const response = await fetch(`${this.baseUrl}/api/learn/download-from-hf`, {
            method: 'GET',
            headers: this.getHeaders(),
        });

        if (!response.ok) {
            throw new Error(`HuggingFace download failed: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Get learning stats including HuggingFace sync status
     */
    async getLearningStats(): Promise<{
        total_training_pairs: number;
        external_model_pairs: number;
        total_knowledge: number;
        learning_enabled: boolean;
        restrictions: string;
        content_filter: string;
        huggingface_repo: string;
        hf_sync_enabled: boolean;
        last_sync_count: number;
        pending_sync: number;
    }> {
        const response = await fetch(`${this.baseUrl}/api/learn/stats`, {
            method: 'GET',
            headers: this.getHeaders(),
        });

        if (!response.ok) {
            throw new Error(`Learning stats failed: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Analyze a file and answer a question about it
     */
    async analyzeFile(
        file: { uri: string; name: string; type?: string },
        question: string,
        options: { ocrModelId?: string } = {}
    ): Promise<FileAnalyzeResponse> {
        const formData = new FormData();
        formData.append('file', {
            uri: file.uri,
            name: file.name,
            type: file.type || 'application/octet-stream',
        } as any);
        formData.append('question', question);
        if (options.ocrModelId) {
            formData.append('ocr_model_id', options.ocrModelId);
        }

        const response = await fetch(`${this.baseUrl}/api/files/analyze`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`File analysis failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Search the knowledge base
     */
    async searchKnowledge(query: string, k: number = 5): Promise<SearchResult[]> {
        const response = await fetch(`${this.baseUrl}/api/knowledge/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, k }),
        });

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
        }

        const data = await response.json();
        return data.results;
    }

    /**
     * Add knowledge to the database
     */
    async addKnowledge(text: string, source: string = 'app'): Promise<{ chunks_indexed: number }> {
        const response = await fetch(`${this.baseUrl}/api/knowledge/index`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, source }),
        });

        if (!response.ok) {
            throw new Error(`Index failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Get server health status
     */
    async getHealth(): Promise<HealthStatus> {
        const response = await fetch(`${this.baseUrl}/api/health`);

        if (!response.ok) {
            throw new Error(`Health check failed: ${response.status}`);
        }

        const data = await response.json();
        return {
            status: data.status || 'unknown',
            service: data.service,
            model_loaded: Boolean(data.model_loaded),
            tokenizer_loaded: Boolean(data.model_loaded),
            vectordb_loaded: Boolean(data.knowledge_loaded),
            knowledge_chunks: data.runtime?.knowledge?.total_vectors,
            is_training: Boolean(data.runtime?.flags?.is_training),
            daemon_running: Boolean(data.runtime?.flags?.daemon_running),
            backend: data.backend,
        };
    }

    /**
     * Ping server to keep it alive (prevents HuggingFace from sleeping)
     */
    async ping(): Promise<{ status: string; timestamp: string; message: string }> {
        const response = await fetch(`${this.baseUrl}/api/ping`);

        if (!response.ok) {
            throw new Error(`Ping failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Submit a correction for learning
     */
    async submitCorrection(
        inputText: string,
        expectedOutput: string,
        actualOutput: string
    ): Promise<{ status: string }> {
        const response = await fetch(`${this.baseUrl}/api/chat/correct`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input_text: inputText,
                expected_output: expectedOutput,
                actual_output: actualOutput,
            }),
        });

        if (!response.ok) {
            throw new Error(`Correction failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Get available LLM models for on-device download
     */
    async getLLMModels(): Promise<LLMModel[]> {
        const response = await fetch(`${this.baseUrl}/api/models/llm`);
        if (!response.ok) {
            throw new Error(`Failed to get LLM models: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Get available image generation models
     */
    async getImageModels(params: { includeAdult?: boolean; includeEdit?: boolean } = {}): Promise<ImageModel[]> {
        const includeAdult = params.includeAdult !== false;
        const includeEdit = params.includeEdit === true;
        const response = await fetch(
            `${this.baseUrl}/api/models/image?include_adult=${includeAdult}&include_edit=${includeEdit}`
        );
        if (!response.ok) {
            throw new Error(`Failed to get image models: ${response.status}`);
        }
        return response.json();
    }

    async getOCRModels(): Promise<OCRModel[]> {
        const response = await fetch(`${this.baseUrl}/api/models/ocr`);
        if (!response.ok) {
            throw new Error(`Failed to get OCR models: ${response.status}`);
        }
        return response.json();
    }

    async getSpeechModels(): Promise<SpeechModel[]> {
        const response = await fetch(`${this.baseUrl}/api/models/speech`);
        if (!response.ok) {
            throw new Error(`Failed to get speech models: ${response.status}`);
        }
        return response.json();
    }

    async getModelStackStatus(): Promise<Record<string, any>> {
        const response = await fetch(`${this.baseUrl}/api/models/stack/status`);
        if (!response.ok) {
            throw new Error(`Failed to get stack status: ${response.status}`);
        }
        return response.json();
    }

    async voiceChat(params: {
        audioUri: string;
        history?: { role: string; content: string }[];
        context?: string;
        systemPrompt?: string;
        textBackend?: string;
        sttModelId?: string;
        ttsModelId?: string;
        voice?: string;
        speed?: number;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        includeAudio?: boolean;
        useLocalStt?: boolean;
    }): Promise<VoiceChatResult> {
        const formData = new FormData();
        formData.append('audio', {
            uri: params.audioUri,
            name: 'recording.wav',
            type: 'audio/wav',
        } as any);
        formData.append('history_json', JSON.stringify(params.history || []));
        if (params.context) formData.append('context', params.context);
        if (params.systemPrompt) formData.append('system_prompt', params.systemPrompt);
        formData.append('text_backend', params.textBackend || 'server');
        formData.append('stt_model_id', params.sttModelId || 'openai-cosmo-1');
        formData.append('tts_model_id', params.ttsModelId || 'openai-tts-1');
        formData.append('voice', params.voice || 'alloy');
        formData.append('speed', String(params.speed || 1.0));
        formData.append('temperature', String(params.temperature || 0.7));
        formData.append('max_tokens', String(params.maxTokens || 256));
        formData.append('top_p', String(params.topP || 0.9));
        formData.append('include_audio', String(params.includeAudio !== false));
        formData.append('use_local_stt', String(params.useLocalStt || false));

        const response = await fetch(`${this.baseUrl}/api/voice/chat`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Voice chat failed: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Sync training data from on-device LLM to server
     */
    async syncTrainingData(pairs: TrainingPair[], deviceId: string): Promise<{ status: string; synced: number }> {
        const response = await fetch(`${this.baseUrl}/api/training/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairs, device_id: deviceId }),
        });
        if (!response.ok) {
            throw new Error(`Training sync failed: ${response.status}`);
        }
        return response.json();
    }

    // === ROLEPLAY APIs ===

    /**
     * Get available roleplay characters
     */
    async getRoleplayCharacters(): Promise<{ characters: RoleplayCharacter[]; total: number }> {
        const response = await fetch(`${this.baseUrl}/api/roleplay/characters`);
        if (!response.ok) {
            throw new Error(`Failed to get characters: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Chat with a roleplay character
     */
    async roleplayChat(params: {
        characterId: string;
        message: string;
        conversationHistory?: { role: string; content: string }[];
        isLocal?: boolean;
        userId?: string;
        sessionId?: string;
    }): Promise<{ character: string; avatar: string; response: string }> {
        const response = await fetch(`${this.baseUrl}/api/roleplay/chat`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                character_id: params.characterId,
                message: params.message,
                conversation_history: params.conversationHistory || [],
                is_local: params.isLocal !== false,
                user_id: params.userId,
                session_id: params.sessionId,
            }),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            if (error.detail?.error === 'insufficient_tokens') {
                throw new Error(`Not enough tokens: ${error.detail.message}`);
            }
            throw new Error(error.detail || `Roleplay chat failed: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Create a custom roleplay character
     */
    async createCustomCharacter(character: {
        name: string;
        avatar: string;
        description: string;
        personality: string;
        system_prompt: string;
        tags: string[];
    }): Promise<{ status: string; character: RoleplayCharacter }> {
        const response = await fetch(`${this.baseUrl}/api/roleplay/custom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(character),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Create character failed: ${response.status}`);
        }
        return response.json();
    }
    /**
     * Get chat histories for a user
     */
    async getChatHistories(userId: string): Promise<{ success: boolean; histories: any[] }> {
        const response = await fetch(`${this.baseUrl}/api/history/${userId}`);
        if (!response.ok) {
            throw new Error(`Failed to get histories: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Create a new chat history
     */
    async createChatHistory(userId: string, title: string, messages: any[]): Promise<{ success: boolean; id: string }> {
        const response = await fetch(`${this.baseUrl}/api/history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                title,
                messages,
            }),
        });
        if (!response.ok) {
            throw new Error(`Failed to create history: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Update an existing chat history
     */
    async updateChatHistory(chatId: string, updates: { title?: string; messages?: any[] }): Promise<{ success: boolean }> {
        const response = await fetch(`${this.baseUrl}/api/history/${chatId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        if (!response.ok) {
            throw new Error(`Failed to update history: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Delete a chat history
     */
    async deleteChatHistory(chatId: string): Promise<{ success: boolean }> {
        const response = await fetch(`${this.baseUrl}/api/history/${chatId}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            throw new Error(`Failed to delete history: ${response.status}`);
        }
        return response.json();
    }

    // === LEARNING SYSTEM APIs ===

    /**
     * Submit training data to learning system
     */
    async submitTrainingData(params: {
        input: string;
        output: string;
        model: string;
        userId?: string;
    }): Promise<{ status: string; message: string }> {
        const response = await fetch(`${this.baseUrl}/api/learn/add`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            throw new Error(`Failed to submit training data: ${response.status}`);
        }
        return response.json();
    }

    // === ANALYTICS APIs ===

    /**
     * Get user usage analytics
     */
    async getUsageAnalytics(params: {
        userId: string;
        period?: 'day' | 'week' | 'month';
    }): Promise<{
        total_requests: number;
        successful_requests: number;
        failed_requests: number;
        average_response_time: number;
        requests_by_day: { date: string; count: number }[];
    }> {
        const period = params.period || 'week';
        const response = await fetch(`${this.baseUrl}/api/analytics/usage?user_id=${params.userId}&period=${period}`);
        if (!response.ok) {
            throw new Error(`Failed to get usage analytics: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Get token usage analytics
     */
    async getTokenAnalytics(params: {
        userId: string;
        period?: 'day' | 'week' | 'month';
    }): Promise<{
        total_tokens_used: number;
        tokens_by_feature: { feature: string; tokens: number }[];
        tokens_by_day: { date: string; tokens: number }[];
        average_daily_usage: number;
    }> {
        const period = params.period || 'week';
        const response = await fetch(`${this.baseUrl}/api/analytics/tokens?user_id=${params.userId}&period=${period}`);
        if (!response.ok) {
            throw new Error(`Failed to get token analytics: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Get popular models analytics
     */
    async getPopularModels(): Promise<{
        models: { model: string; usage_count: number; percentage: number }[];
    }> {
        const response = await fetch(`${this.baseUrl}/api/analytics/popular-models`);
        if (!response.ok) {
            throw new Error(`Failed to get popular models: ${response.status}`);
        }
        return response.json();
    }

    // === ADMIN APIs ===

    /**
     * Get admin dashboard stats
     */
    async getAdminStats(params: {
        adminToken?: string;
    } = {}): Promise<{
        total_users: number;
        active_users_today: number;
        total_requests_today: number;
        total_tokens_used_today: number;
        server_health: string;
    }> {
        const response = await fetch(`${this.baseUrl}/api/admin/stats`, {
            headers: this.getAdminHeaders(params.adminToken),
        });
        if (!response.ok) {
            throw new Error(`Failed to get admin stats: ${response.status}`);
        }
        return response.json();
    }

    /**
     * Get all users (admin only)
     */
    async getUsers(params: {
        page?: number;
        limit?: number;
        adminToken?: string;
    }): Promise<{
        users: any[];
        total: number;
        page: number;
        pages: number;
    }> {
        const page = params.page || 1;
        const limit = params.limit || 20;
        const response = await fetch(`${this.baseUrl}/api/admin/users?page=${page}&limit=${limit}`, {
            headers: this.getAdminHeaders(params.adminToken),
        });
        if (!response.ok) {
            throw new Error(`Failed to get users: ${response.status}`);
        }
        const data = await response.json();
        return {
            ...data,
            pages: Math.max(1, Math.ceil((data.total || 0) / limit)),
        };
    }
}

// Roleplay character interface
export interface RoleplayCharacter {
    id: string;
    name: string;
    avatar: string;
    description: string;
    personality: string;
    tags: string[];
    system_prompt?: string;
    greeting?: string;
    nsfw?: boolean;
    premium: boolean;
}

// Export singleton instance
export const cosmoAPI = new CosmoAPI();
export default cosmoAPI;
