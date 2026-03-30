/**
 * Whisper App - HuggingFace Service
 * Uses official @huggingface/inference and @huggingface/hub libraries
 * for serverless inference and model downloads
 */

import { HfInference } from '@huggingface/inference';
import * as FileSystem from 'expo-file-system/legacy';

// HuggingFace client - uses free tier (no API key required for public models)
// Optional: Set HF_TOKEN env var for higher rate limits
const HF_TOKEN = process.env.EXPO_PUBLIC_HF_TOKEN || undefined;

// Initialize HuggingFace Inference client
const hf = new HfInference(HF_TOKEN);

// Model mappings for inference
export const HF_IMAGE_MODELS = {
    'sdxl-turbo': 'stabilityai/sdxl-turbo',
    'sd-turbo': 'stabilityai/sd-turbo',
    'sd-1.5': 'runwayml/stable-diffusion-v1-5',
    'dreamshaper-8': 'Lykon/dreamshaper-8',
    'epicrealism': 'emilianJR/epiCRealism',
    'deliberate-v3': 'XpucT/Deliberate',
    'absolutereality': 'Lykon/AbsoluteReality',
    'chilloutmix': 'emilianJR/chilloutmix_NiPrunedFp32Fix',
} as const;

export type HFImageModelId = keyof typeof HF_IMAGE_MODELS;

/**
 * Generate image using HuggingFace Inference API
 * Uses @huggingface/inference official library
 * Returns base64 data URI for React Native Image component
 */
export async function generateImageHF(
    prompt: string,
    modelId: HFImageModelId = 'sdxl-turbo',
    options?: {
        negativePrompt?: string;
        width?: number;
        height?: number;
    }
): Promise<string | null> {
    const hfModel = HF_IMAGE_MODELS[modelId] || HF_IMAGE_MODELS['sdxl-turbo'];

    try {
        console.log(`[HF] Generating image with ${hfModel}...`);

        // textToImage returns Blob (type definition says string but it's Blob)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await hf.textToImage({
            model: hfModel,
            inputs: prompt,
            parameters: {
                negative_prompt: options?.negativePrompt,
                width: options?.width || 512,
                height: options?.height || 512,
            },
        });

        // Handle result - could be Blob or ArrayBuffer
        let base64: string;
        if (result instanceof Blob) {
            const arrayBuffer = await result.arrayBuffer();
            base64 = bufferToBase64(arrayBuffer);
        } else if (result instanceof ArrayBuffer) {
            base64 = bufferToBase64(result);
        } else if (typeof result === 'string') {
            // Already base64 or URL
            base64 = result;
        } else {
            throw new Error('Unexpected result type from HF API');
        }

        const dataUri = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
        console.log(`[HF] Image generated successfully`);
        return dataUri;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[HF] Image generation failed:`, errorMessage);
        return null;
    }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ============================================
// MODEL DOWNLOAD UTILITIES
// Uses huggingface.co/resolve/main/ URL pattern
// ============================================

export interface DownloadProgress {
    modelId: string;
    progress: number;
    totalBytes: number;
    downloadedBytes: number;
}

/**
 * Build HuggingFace download URL
 * URL format: https://huggingface.co/{repo_id}/resolve/main/{filename}
 */
export function buildHFDownloadUrl(repoId: string, filename: string): string {
    return `https://huggingface.co/${repoId}/resolve/main/${filename}`;
}

/**
 * Download a model file from HuggingFace Hub
 * Uses Expo FileSystem for React Native compatibility
 */
export async function downloadModelFile(
    repoId: string,
    filename: string,
    destPath: string,
    onProgress?: (progress: DownloadProgress) => void
): Promise<boolean> {
    const url = buildHFDownloadUrl(repoId, filename);

    console.log(`[HF] Downloading from: ${url}`);

    try {
        const downloadResumable = FileSystem.createDownloadResumable(
            url,
            destPath,
            {},
            (downloadProgress) => {
                const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
                onProgress?.({
                    modelId: repoId,
                    progress,
                    totalBytes: downloadProgress.totalBytesExpectedToWrite,
                    downloadedBytes: downloadProgress.totalBytesWritten,
                });
            }
        );

        const result = await downloadResumable.downloadAsync();

        if (result?.status === 200) {
            console.log(`[HF] Download complete: ${filename}`);
            return true;
        } else {
            console.error(`[HF] Download failed with status: ${result?.status}`);
            return false;
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[HF] Download error:`, errorMessage);
        return false;
    }
}

/**
 * Check if a model file exists locally
 */
export async function isModelDownloaded(filePath: string): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(filePath);
    return info.exists;
}

export default {
    hf,
    generateImageHF,
    buildHFDownloadUrl,
    downloadModelFile,
    isModelDownloaded,
    HF_IMAGE_MODELS,
};
