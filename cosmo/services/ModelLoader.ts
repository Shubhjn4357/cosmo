/**
 * Cosmo App - Model Loader Service
 * Handles loading custom models (.pte and .gguf) from device storage
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { storagePermissions } from './storagePermissions';

export type ModelFormat = 'pte' | 'gguf' | 'unknown';

export interface LoadedModel {
    uri: string;
    name: string;
    format: ModelFormat;
    size: number;
    loadedAt: string;
}

const MODEL_STORAGE_KEY = '@cosmo_loaded_model';

// Web-safe mock for FileSystem
const MockFileSystem = {
    documentDirectory: null,
    copyAsync: async () => { },
    getInfoAsync: async () => ({ exists: false, size: 0 }),
    deleteAsync: async () => { },
};

// Use real FileSystem only on native
const FS = Platform.OS === 'web' ? MockFileSystem : FileSystem;

/**
 * Get the models directory path based on platform
 * Android: Uses external storage directory + /cosmo/model
 * iOS: Uses app documents directory + /cosmo/model
 */
function getModelsDirectory(): string {
    // Web safe path
    if (Platform.OS === 'web' || !FS.documentDirectory) {
        return '';
    }
    return `${FS.documentDirectory}cosmo/model/`;
}

const MODELS_DIR = getModelsDirectory();

class ModelLoaderService {
    /**
     * Pick a model file from device storage
     */
    async pickModelFile(): Promise<DocumentPicker.DocumentPickerResult> {
        return await DocumentPicker.getDocumentAsync({
            type: ['*/*'], // Allow all files, we'll validate format
            copyToCacheDirectory: false,
        });
    }

    /**
     * Detect model format from file extension
     */
    detectFormat(filename: string): ModelFormat {
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'pte') return 'pte';
        if (ext === 'gguf') return 'gguf';
        return 'unknown';
    }

    /**
     * Copy model to app's document directory
     */
    async copyModelToStorage(sourceUri: string, filename: string): Promise<string> {
        // Request permissions first on Android
        if (Platform.OS === 'android') {
            const hasPermission = await storagePermissions.hasPermissions();
            if (!hasPermission) {
                const granted = await storagePermissions.requestPermissions();
                if (!granted) {
                    throw new Error('Storage permissions not granted. Please enable storage access in settings.');
                }
            }
        }

        // Ensure models directory exists
        const modelsDir = storagePermissions.getModelsDirectory();

        const destUri = `${MODELS_DIR}/${filename}`;
        await FS.copyAsync({
            from: sourceUri,
            to: destUri,
        });

        return destUri;
    }

    /**
     * Load a model from device
     */
    async loadModel(): Promise<LoadedModel | null> {
        try {
            const result = await this.pickModelFile();

            if (result.canceled || !result.assets || result.assets.length === 0) {
                return null;
            }

            const asset = result.assets[0];
            const format = this.detectFormat(asset.name);

            if (format === 'unknown') {
                throw new Error('Unsupported model format. Please select a .pte or .gguf file.');
            }

            // Copy to app storage
            const localUri = await this.copyModelToStorage(asset.uri, asset.name);

            // Get file info
            const fileInfo = await FS.getInfoAsync(localUri);

            const model: LoadedModel = {
                uri: localUri,
                name: asset.name,
                format,
                size: (fileInfo as any).size || 0,
                loadedAt: new Date().toISOString(),
            };

            // Save to AsyncStorage
            await AsyncStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model));

            return model;
        } catch (error) {
            console.error('Error loading model:', error);
            throw error;
        }
    }

    /**
     * Get currently loaded model
     */
    async getLoadedModel(): Promise<LoadedModel | null> {
        try {
            const data = await AsyncStorage.getItem(MODEL_STORAGE_KEY);
            if (!data) return null;

            const model: LoadedModel = JSON.parse(data);

            // Verify file still exists
            const fileInfo = await FS.getInfoAsync(model.uri);
            if (!fileInfo.exists) {
                await this.clearLoadedModel();
                return null;
            }

            return model;
        } catch (error) {
            console.error('Error getting loaded model:', error);
            return null;
        }
    }

    /**
     * Clear loaded model
     */
    async clearLoadedModel(): Promise<void> {
        try {
            const model = await this.getLoadedModel();
            if (model) {
                // Delete the file
                await FS.deleteAsync(model.uri, { idempotent: true });
            }
            await AsyncStorage.removeItem(MODEL_STORAGE_KEY);
        } catch (error) {
            console.error('Error clearing model:', error);
        }
    }

    /**
     * Format file size to human readable
     */
    formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }
}

export const modelLoader = new ModelLoaderService();
