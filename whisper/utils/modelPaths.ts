/**
 * Model Path Utilities
 * Centralized, dynamic path resolution for GGUF models
 * Ensures download and loading use the same runtime path
 */

import * as FileSystem from 'expo-file-system/legacy';

/**
 * Get the runtime models directory path
 * This is the SINGLE SOURCE OF TRUTH for model storage
 * Returns a clean path without file:// prefix
 */
export function getModelsDirectory(): string {
    // Use cacheDirectory for temporary/downloaded files
    // This resolves to the correct path at runtime for each platform
    let baseDir = FileSystem.cacheDirectory;
    if (!baseDir) {
        throw new Error('FileSystem.cacheDirectory is not available');
    }

    // Strip file:// prefix if present for consistency
    if (baseDir.startsWith('file://')) {
        baseDir = baseDir.replace('file://', '');
    }

    return `${baseDir}models/`;
}

/**
 * Get the models directory WITH file:// protocol for FileSystem operations
 * FileSystem methods require the file:// prefix
 */
export function getModelsDirectoryWithProtocol(): string {
    const baseDir = FileSystem.cacheDirectory;
    if (!baseDir) {
        throw new Error('FileSystem.cacheDirectory is not available');
    }
    return `${baseDir}models/`;
}


/**
 * Get the full path for a specific model file
 * @param modelId - The model ID (e.g., 'tinyllama-1.1b-q4')
 * @param withProtocol - If true, returns path with file:// for FileSystem operations
 */
export function getModelFilePath(modelId: string, withProtocol: boolean = false): string {
    if (withProtocol) {
        // Return with file:// for FileSystem operations
        const baseDir = FileSystem.cacheDirectory;
        if (!baseDir) throw new Error('FileSystem.cacheDirectory is not available');
        return `${baseDir}models/${modelId}.gguf`;
    } else {
        // Return sanitized path for config/display
        const modelsDir = getModelsDirectory();
        return `${modelsDir}${modelId}.gguf`;
    }
}

/**
 * Ensure the models directory exists
 * Creates it if necessary
 */
export async function ensureModelsDirectoryExists(): Promise<void> {
    // Get the base directory WITH file:// for FileSystem operations
    let baseDirWithProtocol = FileSystem.cacheDirectory;
    if (!baseDirWithProtocol) {
        throw new Error('FileSystem.cacheDirectory is not available');
    }

    // FileSystem operations need the file:// protocol
    const modelsDirWithProtocol = `${baseDirWithProtocol}models/`;

    try {
        await FileSystem.makeDirectoryAsync(modelsDirWithProtocol, { intermediates: true });
    } catch (e) {
        // Check if it exists anyway
        const dirInfo = await FileSystem.getInfoAsync(modelsDirWithProtocol);
        if (!dirInfo.exists || !dirInfo.isDirectory) {
            console.error('Failed to create models directory:', e);
            // Don't throw - just log the error
            // The directory might not exist yet but will be created on first download
        }
    }
}

/**
 * List all downloaded model files
 */
export async function listDownloadedModels(): Promise<string[]> {
    const baseDir = FileSystem.cacheDirectory;
    if (!baseDir) return [];
    const modelsDirWithProtocol = `${baseDir}models/`;

    try {
        await ensureModelsDirectoryExists();
        const files = await FileSystem.readDirectoryAsync(modelsDirWithProtocol);
        return files.filter(f => f.endsWith('.gguf'));
    } catch (error) {
        console.error('Failed to list models:', error);
        return [];
    }
}

/**
 * Check if a specific model is downloaded
 */
export async function isModelDownloaded(modelId: string): Promise<boolean> {
    const modelPath = getModelFilePath(modelId, true); // Use file:// version
    const info = await FileSystem.getInfoAsync(modelPath);
    return info.exists && !info.isDirectory;
}

/**
 * Get info about a downloaded model
 */
export async function getModelInfo(modelId: string): Promise<{
    exists: boolean;
    size?: number;
    path?: string;
}> {
    const modelPathWithProtocol = getModelFilePath(modelId, true);
    const modelPathSanitized = getModelFilePath(modelId, false);
    const info = await FileSystem.getInfoAsync(modelPathWithProtocol);

    if (info.exists && !info.isDirectory) {
        return {
            exists: true,
            size: info.size,
            path: modelPathSanitized, // Return sanitized path for config
        };
    }

    return { exists: false };
}

/**
 * Delete a model file
 */
export async function deleteModel(modelId: string): Promise<void> {
    const modelPath = getModelFilePath(modelId, true); // Use file:// version
    await FileSystem.deleteAsync(modelPath);
}
