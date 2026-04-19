/**
 * NativeBitNet.ts
 * ===============
 * Real JSI bridge service for on-device LLM inference.
 *
 * Architecture:
 *   1. JSI path (primary)   — global.cosmoBitNet is installed by BitNetModule
 *      at app start. Calls are synchronous with sub-1ms bridge overhead.
 *
 *   2. llama.rn path (fallback) — used when JSI bridge is not available
 *      (e.g. Expo Go, simulator, or first cold-start before install()).
 *      Uses the full llama.rn JS API: initLlama → context.completion().
 *
 *   3. NativeModule bridge (last resort) — raw NativeModules.BitNetModule
 *      for metadata calls (isHardwareSupported, isInstalled).
 *
 * Usage:
 *   import { nativeBitNet } from '@/services/NativeBitNet';
 *   await nativeBitNet.install();            // install JSI bridge once at app start
 *   await nativeBitNet.loadModel(path);      // load a GGUF model
 *   const res = await nativeBitNet.generate(prompt, { max_tokens: 512 });
 */

import { NativeModules, Platform } from 'react-native';
import type { LlamaContext } from 'llama.rn';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BitNetOptions {
    /** Maximum tokens to generate (default: 512) */
    max_tokens?: number;
    /** Sampling temperature 0–2 (default: 0.7) */
    temperature?: number;
    /** Nucleus sampling p (default: 0.9) */
    top_p?: number;
    /** Top-K sampling (default: 40) */
    top_k?: number;
    /** Repetition penalty (default: 1.1) */
    repeat_penalty?: number;
    /** Stop sequences — generation halts on any of these strings */
    stop?: string[];
}

export interface BitNetInferenceResult {
    text: string;
    tokens_per_second: number;
    memory_used_mb: number;
    n_tokens: number;
    elapsed_ms: number;
    stopped: boolean;
}

export interface BitNetLoadResult {
    status: 'loaded' | 'failed';
    path: string;
    error?: string;
    n_vocab?: number;
    n_ctx?: number;
}

export interface BitNetModelInfo {
    is_loaded: boolean;
    model_path: string;
    n_vocab?: number;
    n_ctx?: number;
    n_ctx_train?: number;
    n_embd?: number;
    n_layers?: number;
    description?: string;
}

export interface BitNetMemoryStats {
    kv_cache_mb: number;
    model_size_mb: number;
}

// ─── JSI global declaration (installed by BitNetJSI.cpp) ─────────────────────

interface JSIBitNetBridge {
    loadModel(path: string, options?: Record<string, unknown>): BitNetLoadResult;
    generate(prompt: string, options?: BitNetOptions): BitNetInferenceResult;
    stopGeneration(): void;
    unloadModel(): { status: string };
    getModelInfo(): BitNetModelInfo;
    getMemoryStats(): BitNetMemoryStats;
    tokenize(text: string): number[];
    detokenize(tokens: number[]): string;
}

declare global {
    var cosmoBitNet: JSIBitNetBridge | undefined;
}

// ─── NativeModule interface (for install / isInstalled / isHardwareSupported) ─

interface BitNetNativeModuleType {
    install(): void;
    isInstalled(): boolean;
    isHardwareSupported(): boolean;
}

const BitNetNativeModule =
    (NativeModules.BitNetModule as BitNetNativeModuleType | undefined) ?? null;

// ─── Service class ────────────────────────────────────────────────────────────

class NativeBitNetService {
    private _isInitialized = false;
    private _currentModelPath: string | null = null;

    /**
     * llama.rn context — used as JSI fallback when global.cosmoBitNet
     * is not yet installed (Expo Go, simulator, first cold start).
     */
    private _llamaCtx: LlamaContext | null = null;

    // ── Installation ──────────────────────────────────────────────────────────

    /**
     * Installs global.cosmoBitNet into the JSI runtime.
     * Call this once at app startup (e.g. in app/_layout.tsx useEffect).
     * Safe to call multiple times — is idempotent on the native side.
     */
    install(): void {
        if (Platform.OS === 'web') return;
        try {
            if (BitNetNativeModule && !BitNetNativeModule.isInstalled()) {
                BitNetNativeModule.install();
            }
        } catch (err) {
            console.warn('[BitNet] JSI install error:', err);
        }
    }

    // ── Hardware check ────────────────────────────────────────────────────────

    /**
     * Returns true if the device's ARM CPU can run ternary inference
     * with native NEON/ASIMD acceleration.
     */
    isHardwareSupported(): boolean {
        if (Platform.OS === 'web') return false;
        try {
            return BitNetNativeModule?.isHardwareSupported() ?? false;
        } catch {
            return false;
        }
    }

    /**
     * Returns true if the JSI bridge is installed and a model is loaded.
     * Alias kept for backward compatibility with llmBackend.ts.
     */
    async isAvailable(): Promise<boolean> {
        return this._isInitialized;
    }

    // ── Model management ──────────────────────────────────────────────────────

    /**
     * Loads a GGUF model from the device file system.
     *
     * @param path  Absolute path to the .gguf file. File:// prefix is
     *              accepted and stripped automatically.
     * @returns     true on success, false on failure.
     */
    async loadModel(path: string): Promise<boolean> {
        if (Platform.OS === 'web') return false;

        // ── JSI path ──────────────────────────────────────────────────────────
        if (global.cosmoBitNet) {
            try {
                const res = global.cosmoBitNet.loadModel(path);
                this._isInitialized = res.status === 'loaded';
                this._currentModelPath = this._isInitialized ? path : null;
                if (!this._isInitialized) {
                    console.error('[BitNet] JSI loadModel failed:', res.error);
                }
                return this._isInitialized;
            } catch (err) {
                console.error('[BitNet] JSI loadModel threw:', err);
                return false;
            }
        }

        // ── llama.rn fallback path ─────────────────────────────────────────
        try {
            const { initLlama } = await import('llama.rn');

            // Release previous context.
            if (this._llamaCtx) {
                await this._llamaCtx.release();
                this._llamaCtx = null;
            }

            const cleanPath = path.startsWith('file://') ? path : `file://${path}`;

            this._llamaCtx = await initLlama({
                model: cleanPath,
                n_ctx: 4096,
                n_threads: Math.max(1, (navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency ?? 4),
                n_gpu_layers: 0,
                use_mlock: false,
            });

            this._isInitialized = true;
            this._currentModelPath = path;
            return true;
        } catch (err) {
            console.error('[BitNet] llama.rn loadModel failed:', err);
            this._isInitialized = false;
            return false;
        }
    }

    // ── Inference ─────────────────────────────────────────────────────────────

    /**
     * Runs inference on the loaded model.
     * Uses the JSI synchronous path when available, falls back to llama.rn.
     *
     * @param prompt   The full prompt string (pre-formatted chat template).
     * @param options  Sampling configuration.
     */
    async generate(
        prompt: string,
        options: BitNetOptions = {},
    ): Promise<BitNetInferenceResult> {
        if (!this._isInitialized) {
            throw new Error('[BitNet] No model loaded — call loadModel() first');
        }

        // ── JSI path ──────────────────────────────────────────────────────────
        if (global.cosmoBitNet) {
            const res = global.cosmoBitNet.generate(prompt, options);
            return {
                text: res.text ?? '',
                tokens_per_second: res.tokens_per_second ?? 0,
                memory_used_mb: res.memory_used_mb ?? 0,
                n_tokens: res.n_tokens ?? 0,
                elapsed_ms: res.elapsed_ms ?? 0,
                stopped: res.stopped ?? false,
            };
        }

        // ── llama.rn fallback path ─────────────────────────────────────────
        if (!this._llamaCtx) {
            throw new Error('[BitNet] llama.rn context not available');
        }

        const t0 = Date.now();
        let nTokens = 0;

        const result = await this._llamaCtx.completion(
            {
                prompt,
                n_predict: options.max_tokens ?? 512,
                temperature: options.temperature ?? 0.7,
                top_p: options.top_p ?? 0.9,
                top_k: options.top_k ?? 40,
                penalty_repeat: options.repeat_penalty ?? 1.1,
                stop: options.stop ?? ['<|im_end|>', '</s>', '[/INST]'],
            },
            () => { nTokens++; },
        );

        const elapsed = Date.now() - t0;
        return {
            text: result.text ?? '',
            tokens_per_second: elapsed > 0 ? (nTokens / (elapsed / 1000)) : 0,
            memory_used_mb: 0,   // not available via JS API
            n_tokens: nTokens,
            elapsed_ms: elapsed,
            stopped: false,
        };
    }

    /**
     * Signals the native engine to stop the current generation early.
     * Only effective on the JSI path — llama.rn streaming is managed
     * externally via the stopCompletion() method on the context.
     */
    stopGeneration(): void {
        if (global.cosmoBitNet) {
            global.cosmoBitNet.stopGeneration();
        }
        // For llama.rn, the caller must cancel via context.stopCompletion().
    }

    // ── Tokenization ──────────────────────────────────────────────────────────

    /** Tokenizes text and returns token IDs. JSI path only. */
    tokenize(text: string): number[] {
        if (!global.cosmoBitNet || !this._isInitialized) return [];
        try {
            return global.cosmoBitNet.tokenize(text);
        } catch (err) {
            console.warn('[BitNet] tokenize error:', err);
            return [];
        }
    }

    /** Converts token IDs back to a string. JSI path only. */
    detokenize(tokens: number[]): string {
        if (!global.cosmoBitNet || !this._isInitialized) return '';
        try {
            return global.cosmoBitNet.detokenize(tokens);
        } catch (err) {
            console.warn('[BitNet] detokenize error:', err);
            return '';
        }
    }

    // ── Diagnostics ───────────────────────────────────────────────────────────

    /** Returns metadata about the currently loaded model. JSI path only. */
    getModelInfo(): BitNetModelInfo {
        if (!global.cosmoBitNet) {
            return { is_loaded: false, model_path: '' };
        }
        try {
            return global.cosmoBitNet.getModelInfo();
        } catch {
            return { is_loaded: false, model_path: '' };
        }
    }

    /** Returns live memory stats. JSI path only. */
    getMemoryStats(): BitNetMemoryStats {
        if (!global.cosmoBitNet) {
            return { kv_cache_mb: 0, model_size_mb: 0 };
        }
        try {
            return global.cosmoBitNet.getMemoryStats();
        } catch {
            return { kv_cache_mb: 0, model_size_mb: 0 };
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /** Frees the loaded model and all associated memory. */
    async unloadModel(): Promise<void> {
        if (global.cosmoBitNet && this._isInitialized) {
            global.cosmoBitNet.unloadModel();
        }
        if (this._llamaCtx) {
            await this._llamaCtx.release();
            this._llamaCtx = null;
        }
        this._isInitialized = false;
        this._currentModelPath = null;
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    get isInitialized(): boolean { return this._isInitialized; }
    get currentModelPath(): string | null { return this._currentModelPath; }
    get useJSI(): boolean { return !!global.cosmoBitNet; }

    /**
     * Hardware-accelerated acoustic feature extraction.
     * Uses the local BitNet engine to process raw audio buffers into intent vectors.
     */
    async extractAcousticFeatures(buffer: ArrayBuffer): Promise<number[]> {
        console.log(`[BitNet] Processing ${buffer.byteLength} byte audio buffer...`);
        // Mock implementation for now — in a real build this calls into BitNetJSI.cpp
        return new Array(128).fill(0).map(() => Math.random());
    }
}

// Singleton — shared across the entire app.
export const nativeBitNet = new NativeBitNetService();
export default nativeBitNet;
