/**
 * Whisper AI/**
 * Local LLM Service
 * Handles local language model inference using llama.rn
 * Note: Only works on native platforms (iOS/Android), not web
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LLMModel, TrainingPair } from './api';
import { modelLoader } from './ModelLoader';

// Type definitions for llama.rn (when available)
type LlamaInitOptions = {
    model: string;
    n_ctx?: number;
    n_threads?: number;
    n_gpu_layers?: number;
};

type LlamaCompletionOptions = {
    prompt: string;
    n_predict?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stop?: string[];
};

type LlamaCompletionData = {
    token?: string;
};

interface LlamaContextInterface {
    completion(
        options: LlamaCompletionOptions,
        callback?: (data: LlamaCompletionData) => void
    ): Promise<{ text: string }>;
    release(): Promise<void>;
}

// Only import native module on mobile platforms
let initLlama: ((options: LlamaInitOptions) => Promise<LlamaContextInterface>) | null = null;
let LlamaContext: any = null; // Keep as any since it's a class we don't instantiate directly

if (Platform.OS !== 'web') {
    try {
        const llamaModule = require('llama.rn');
        initLlama = llamaModule.initLlama;
        LlamaContext = llamaModule.LlamaContext;
    } catch (error) {
        console.warn('llama.rn not available:', error);
    }
}

/**
 * Get the models directory path based on platform
 * Android: Uses external storage directory + /whisper/model  
 * iOS: Uses app documents directory + /whisper/model
 */
function getModelsDirectory(): string {
    // Use internal app directory (no permissions needed)
    if (Platform.OS === 'android') {
        return `${FileSystem.documentDirectory}models/`;
    } else {
        return `${FileSystem.documentDirectory}models/`;
    }
}

const MODELS_DIR = getModelsDirectory();
const TRAINING_STORE_KEY = 'training_pairs';

export interface LocalModelState {
    isLoaded: boolean;
    modelId: string | null;
    context: LlamaContextInterface | null;
    downloadProgress: number;
    isDownloading: boolean;
    error: string | null;
}

class LocalLLMService {
    private context: LlamaContextInterface | null = null;
    private currentModelId: string | null = null;
    private trainingPairs: TrainingPair[] = [];
    private activeDownload: FileSystem.DownloadResumable | null = null;
    private downloadModelId: string | null = null;
    private isPaused: boolean = false;

    constructor() {
        this.ensureModelsDir();
        this.loadTrainingPairs();
    }

    private async ensureModelsDir() {
        try {
            const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
            }
        } catch (e) {
            console.error('Failed to create models dir:', e);
        }
    }

    private async loadTrainingPairs() {
        try {
            const data = await AsyncStorage.getItem(TRAINING_STORE_KEY);
            if (data) {
                this.trainingPairs = JSON.parse(data);
            }
        } catch (e) {
            console.error('Failed to load training pairs:', e);
        }
    }

    async getDownloadedModels(): Promise<string[]> {
        try {
            // Check if dir exists first
            const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
            if (!dirInfo.exists) return [];

            const files = await FileSystem.readDirectoryAsync(MODELS_DIR);
            return files
                .filter(name => name.endsWith('.gguf'))
                .map(name => name.replace('.gguf', ''));
        } catch (e) {
            return [];
        }
    }

    async isModelDownloaded(modelId: string): Promise<boolean> {
        const modelPath = `${MODELS_DIR}/${modelId}.gguf`;
        const fileInfo = await FileSystem.getInfoAsync(modelPath);
        return fileInfo.exists;
    }

    async downloadModel(
        model: LLMModel, 
        onProgress?: (progress: number) => void
    ): Promise<boolean> {
        if (this.isDownloading()) {
            console.warn('Download already in progress');
            return false;
        }

        const modelPath = `${MODELS_DIR}/${model.id}.gguf`;
        const downloadUrl = `https://huggingface.co/${model.repo_id}/resolve/main/${model.filename}`;
        const resumeKey = `resume_llm_${model.id}`;

        this.downloadModelId = model.id;
        this.isPaused = false;

        try {
            // Check for existing resume data
            const savedResumeData = await AsyncStorage.getItem(resumeKey);

            const callback = (downloadProgress: FileSystem.DownloadProgressData) => {
                const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
                onProgress?.(progress);
            };

            if (savedResumeData) {
                try {
                    const parsedData = JSON.parse(savedResumeData);
                    this.activeDownload = new FileSystem.DownloadResumable(
                        downloadUrl,
                        modelPath,
                        {},
                        callback,
                        parsedData
                    );
                } catch {
                    // Invalid resume data, start fresh
                    await AsyncStorage.removeItem(resumeKey);
                    this.activeDownload = FileSystem.createDownloadResumable(
                        downloadUrl,
                        modelPath,
                        {},
                        callback
                    );
                }
            } else {
                this.activeDownload = FileSystem.createDownloadResumable(
                    downloadUrl,
                    modelPath,
                    {},
                    callback
                );
            }

            try {
                const result = await this.activeDownload.downloadAsync();
                await AsyncStorage.removeItem(resumeKey); // Clear on success
                this.activeDownload = null;
                this.downloadModelId = null;
                return result ? result.status === 200 : false;
            } catch (e: any) {
                // If paused or interrupted, save resume data
                if (this.activeDownload && !this.isPaused) {
                    try {
                        const resumeData = await this.activeDownload.pauseAsync();
                        await AsyncStorage.setItem(resumeKey, JSON.stringify(resumeData));
                    } catch { }
                }
                console.error('Download interrupted:', e?.message || e);
                return false;
            }
        } catch (e: any) {
            console.error('Download failed:', e?.message || e);
            await AsyncStorage.removeItem(resumeKey);
            this.activeDownload = null;
            this.downloadModelId = null;
            return false;
        }
    }

    async pauseDownload(): Promise<boolean> {
        if (!this.activeDownload || !this.downloadModelId) return false;

        try {
            this.isPaused = true;
            const resumeData = await this.activeDownload.pauseAsync();
            const resumeKey = `resume_llm_${this.downloadModelId}`;
            await AsyncStorage.setItem(resumeKey, JSON.stringify(resumeData));
            return true;
        } catch (e) {
            console.error('Failed to pause download:', e);
            return false;
        }
    }

    async resumeDownload(onProgress?: (progress: number) => void): Promise<boolean> {
        if (!this.activeDownload || !this.downloadModelId) return false;

        try {
            this.isPaused = false;
            const result = await this.activeDownload.resumeAsync();
            const resumeKey = `resume_llm_${this.downloadModelId}`;
            await AsyncStorage.removeItem(resumeKey);
            this.activeDownload = null;
            this.downloadModelId = null;
            return result ? result.status === 200 : false;
        } catch (e) {
            console.error('Failed to resume download:', e);
            return false;
        }
    }

    async cancelDownload(): Promise<boolean> {
        if (!this.activeDownload || !this.downloadModelId) return false;

        try {
            this.isPaused = true;
            await this.activeDownload.pauseAsync();

            // Delete partial file
            const modelPath = `${MODELS_DIR}/${this.downloadModelId}.gguf`;
            const fileInfo = await FileSystem.getInfoAsync(modelPath);
            if (fileInfo.exists) {
                await FileSystem.deleteAsync(modelPath);
            }

            // Clear resume data
            const resumeKey = `resume_llm_${this.downloadModelId}`;
            await AsyncStorage.removeItem(resumeKey);

            this.activeDownload = null;
            this.downloadModelId = null;
            return true;
        } catch (e) {
            console.error('Failed to cancel download:', e);
            return false;
        }
    }

    isDownloading(): boolean {
        return this.activeDownload !== null;
    }

    getDownloadingModelId(): string | null {
        return this.downloadModelId;
    }

    isDownloadPaused(): boolean {
        return this.isPaused;
    }

    async deleteModel(modelId: string): Promise<boolean> {
        try {
            const modelPath = `${MODELS_DIR}/${modelId}.gguf`;
            const fileInfo = await FileSystem.getInfoAsync(modelPath);
            if (fileInfo.exists) {
                await FileSystem.deleteAsync(modelPath);
            }
            if (this.currentModelId === modelId) {
                await this.unloadModel();
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Load a custom model from ModelLoader
     * This integrates with the user-selected .gguf model from the profile screen
     */
    async loadCustomModel(): Promise<boolean> {
        const customModel = await modelLoader.getLoadedModel();
        if (!customModel) {
            return false;
        }

        // Only .gguf files are supported for inference
        if (customModel.format !== 'gguf') {
            console.warn('Custom model is not .gguf format. .pte models require separate ExecuTorch integration.');
            return false;
        }

        // Platform check
        if (Platform.OS === 'web' || !initLlama) {
            console.warn('Local LLM not supported on web platform');
            return false;
        }

        // Check if file exists
        const fileInfo = await FileSystem.getInfoAsync(customModel.uri);
        if (!fileInfo.exists) {
            console.error('Custom model file not found:', customModel.uri);
            return false;
        }

        try {
            // Unload previous model
            if (this.context) {
                await this.context.release();
            }

            // Initialize new model from custom path
            this.context = await initLlama!({
                model: customModel.uri,
                n_ctx: 2048,
                n_threads: 4,
                n_gpu_layers: 0, // CPU only
            });

            this.currentModelId = `custom_${customModel.name}`;
            await AsyncStorage.setItem('loaded_llm_model', this.currentModelId);
            return true;
        } catch (e) {
            console.error('Failed to load custom model:', e);
            return false;
        }
    }

    async loadModel(modelId: string): Promise<boolean> {
        // Platform check: web doesn't support native LLM
        if (Platform.OS === 'web' || !initLlama) {
            console.warn('Local LLM not supported on web platform');
            return false;
        }

        const modelPath = `${MODELS_DIR}/${modelId}.gguf`;
        
        const fileInfo = await FileSystem.getInfoAsync(modelPath);
        if (!fileInfo.exists) {
            console.error('Model not found:', modelPath);
            return false;
        }

        try {
            // Unload previous model
            if (this.context) {
                await this.context.release();
            }

            // Initialize new model
            this.context = await initLlama({
                model: modelPath,
                n_ctx: 2048,
                n_threads: 4,
                n_gpu_layers: 0, // CPU only for now
            });

            this.currentModelId = modelId;
            // Persist to storage
            await AsyncStorage.setItem('loaded_llm_model', modelId);
            return true;
        } catch (e) {
            console.error('Failed to load model:', e);
            return false;
        }
    }

    async unloadModel(): Promise<void> {
        if (this.context) {
            await this.context.release();
            this.context = null;
            this.currentModelId = null;
            await AsyncStorage.removeItem('loaded_llm_model');
        }
    }

    isLoaded(): boolean {
        return this.context !== null;
    }

    /**
     * Check if a custom model is loaded (from ModelLoader)
     */
    async isCustomModelLoaded(): Promise<boolean> {
        const customModel = await modelLoader.getLoadedModel();
        return customModel !== null && customModel.format === 'gguf' && this.context !== null;
    }

    getCurrentModelId(): string | null {
        return this.currentModelId;
    }

    /**
     * Load the persisted model ID from storage
     */
    async loadCurrentModelFromStorage(): Promise<string | null> {
        const savedId = await AsyncStorage.getItem('loaded_llm_model');
        if (savedId) {
            this.currentModelId = savedId;
        }
        return this.currentModelId;
    }

    async generate(
        prompt: string,
        systemPrompt?: string,
        onToken?: (token: string) => void
    ): Promise<string> {
        // Platform check
        if (Platform.OS === 'web') {
            throw new Error('Local LLM not available on web. Please use server mode.');
        }

        if (!this.context) {
            throw new Error('No model loaded');
        }

        // Build the formatted prompt with optional system instructions
        let formattedPrompt = '';
        if (systemPrompt) {
            formattedPrompt = `${systemPrompt}\n\n`;
        }
        formattedPrompt += `User: ${prompt}\nAssistant:`;

        try {
            const result = await this.context.completion({
                prompt: formattedPrompt,
                n_predict: 512,
                temperature: 0.7,
                top_p: 0.9,
                top_k: 40,
                stop: ['User:', '\nUser:', 'Assistant:', '\n\n\n', '<|im_end|>', '</s>'],
            }, (data) => {
                if (data.token && onToken) {
                    onToken(data.token);
                }
            });

            // Clean up the response - remove any training artifacts or meta-commentary
            let response = result.text.trim();

            // AGGRESSIVE CLEANUP: Cut at first "User:" occurrence (stop multi-turn conversations)
            const userIndex = response.search(/\n\s*User:/i);
            if (userIndex !== -1) {
                response = response.substring(0, userIndex).trim();
            }

            // Remove "Assistant:" prefix if present
            response = response.replace(/^\*\*Assistant:\*\*/i, '');
            response = response.replace(/^Assistant:\s*/i, '');

            // Remove meta-commentary/notes (often appears at end)
            response = response.replace(/\n\s*\*\*Note:.*$/is, '');
            response = response.replace(/\n\s*Note:.*$/is, '');
            response = response.replace(/\n\s*\(.*\)$/s, '');

            response = response.trim();

            // Save training pair
            this.addTrainingPair(prompt, response, this.currentModelId || 'local');

            return response;
        } catch (e) {
            console.error('Generation failed:', e);
            throw e;
        }
    }

    private async addTrainingPair(input: string, output: string, model: string) {
        const pair: TrainingPair = { input, output, model };
        this.trainingPairs.push(pair);
        
        // Keep only last 100 pairs locally
        if (this.trainingPairs.length > 100) {
            this.trainingPairs = this.trainingPairs.slice(-100);
        }
        
        await AsyncStorage.setItem(TRAINING_STORE_KEY, JSON.stringify(this.trainingPairs));
    }

    async getTrainingPairs(): Promise<TrainingPair[]> {
        return [...this.trainingPairs];
    }

    async clearSyncedPairs(count: number): Promise<void> {
        this.trainingPairs = this.trainingPairs.slice(count);
        await AsyncStorage.setItem(TRAINING_STORE_KEY, JSON.stringify(this.trainingPairs));
    }
}

// Singleton export
export const localLLM = new LocalLLMService();
export default localLLM;
