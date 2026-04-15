/**
 * Cosmo AI - External Model Import Service
 * 
 * Allows users to:
 * - Import GGUF files from device storage
 * - Store models in root data folder (persistent across reinstalls)
 * - Load models from Downloads folder
 * 
 * Supports Android's SAF (Storage Access Framework) and iOS file picking.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

// === TYPES ===

export interface ImportedModel {
    id: string;
    name: string;
    filename: string;
    path: string;
    size: number;
    importedAt: string;
    quantization?: string;
    source: 'import' | 'download';
}

export interface ImportResult {
    success: boolean;
    model?: ImportedModel;
    error?: string;
}

// === STORAGE PATHS ===

// Get document directory with fallback
const getDocumentDir = (): string => {
    // @ts-ignore - Property access varies by expo version
    return FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
};

// Root data folder - persists across app reinstalls on Android
const getStoragePath = (): string => {
    const docDir = getDocumentDir();
    if (Platform.OS === 'android') {
        // Use external storage for persistence
        // Note: Requires MANAGE_EXTERNAL_STORAGE permission on Android 11+
        return `${docDir}../models`;
    }
    // iOS - use document directory
    return `${docDir}models`;
};

// Standard models directory (internal storage)
const getModelsDir = (): string => `${getDocumentDir()}gguf_models`;

// Storage key for imported models registry
const IMPORTED_MODELS_KEY = 'imported_gguf_models';

// === MODEL IMPORT SERVICE ===

class ExternalModelImportService {
    private importedModels: ImportedModel[] = [];

    constructor() {
        this.ensureDirectories();
        this.loadImportedModels();
    }

    /**
     * Ensure model directories exist
     */
    private async ensureDirectories(): Promise<void> {
        try {
            const modelsInfo = await FileSystem.getInfoAsync(getModelsDir());
            if (!modelsInfo.exists) {
                await FileSystem.makeDirectoryAsync(getModelsDir(), { intermediates: true });
            }

            // Try to create external directory on Android
            if (Platform.OS === 'android') {
                try {
                    const externalInfo = await FileSystem.getInfoAsync(getStoragePath());
                    if (!externalInfo.exists) {
                        await FileSystem.makeDirectoryAsync(getStoragePath(), { intermediates: true });
                    }
                } catch (e) {
                    console.log('External storage not available, using internal');
                }
            }
        } catch (error) {
            console.error('Failed to create model directories:', error);
        }
    }

    /**
     * Load list of imported models from storage
     */
    private async loadImportedModels(): Promise<void> {
        try {
            const saved = await AsyncStorage.getItem(IMPORTED_MODELS_KEY);
            if (saved) {
                this.importedModels = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Failed to load imported models:', error);
            this.importedModels = [];
        }
    }

    /**
     * Save imported models registry
     */
    private async saveImportedModels(): Promise<void> {
        try {
            await AsyncStorage.setItem(IMPORTED_MODELS_KEY, JSON.stringify(this.importedModels));
        } catch (error) {
            console.error('Failed to save imported models:', error);
        }
    }

    /**
     * Import a GGUF file from device storage
     */
    async importFromDevice(): Promise<ImportResult> {
        try {
            // Open document picker for GGUF files
            const result = await DocumentPicker.getDocumentAsync({
                type: '*/*', // GGUF files might not have a registered MIME type
                copyToCacheDirectory: false, // Don't copy, we'll handle it
            });

            if (result.canceled || !result.assets || result.assets.length === 0) {
                return { success: false, error: 'No file selected' };
            }

            const file = result.assets[0];

            // Check if it's a GGUF file
            if (!file.name.endsWith('.gguf')) {
                return { success: false, error: 'Please select a .gguf file' };
            }

            // Generate unique ID
            const modelId = `imported-${Date.now()}`;
            const targetPath = `${getModelsDir()}/${file.name}`;

            // Check if already exists
            const exists = await FileSystem.getInfoAsync(targetPath);
            if (exists.exists) {
                // Generate unique name
                const uniqueName = `${modelId}-${file.name}`;
                return this.importFile(file.uri, `${getModelsDir()}/${uniqueName}`, uniqueName, modelId);
            }

            return this.importFile(file.uri, targetPath, file.name, modelId);
        } catch (error) {
            console.error('Import error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Import failed'
            };
        }
    }

    /**
     * Copy file to models directory
     */
    private async importFile(
        sourceUri: string,
        targetPath: string,
        filename: string,
        modelId: string
    ): Promise<ImportResult> {
        try {
            // Copy file to models directory
            await FileSystem.copyAsync({
                from: sourceUri,
                to: targetPath,
            });

            // Get file info
            const info = await FileSystem.getInfoAsync(targetPath);

            // Detect quantization from filename
            const quantization = this.detectQuantization(filename);

            // Create model entry
            const model: ImportedModel = {
                id: modelId,
                name: this.generateModelName(filename),
                filename,
                path: targetPath,
                size: info.exists && 'size' in info ? info.size : 0,
                importedAt: new Date().toISOString(),
                quantization,
                source: 'import',
            };

            // Add to registry
            this.importedModels.push(model);
            await this.saveImportedModels();

            return { success: true, model };
        } catch (error) {
            console.error('File copy error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to copy file'
            };
        }
    }

    /**
     * Detect quantization level from filename
     */
    private detectQuantization(filename: string): string {
        const quantPatterns = [
            'Q2_K', 'Q3_K_S', 'Q3_K_M', 'Q3_K_L',
            'Q4_K_S', 'Q4_K_M', 'Q4_K', 'Q4_0', 'Q4_1',
            'Q5_K_S', 'Q5_K_M', 'Q5_K', 'Q5_0', 'Q5_1',
            'Q6_K', 'Q8_0', 'Q8_1',
            'IQ2_XS', 'IQ2_XXS', 'IQ3_XS', 'IQ4_NL',
            'F16', 'F32',
        ];

        const upper = filename.toUpperCase();
        for (const pattern of quantPatterns) {
            if (upper.includes(pattern)) {
                return pattern;
            }
        }

        return 'unknown';
    }

    /**
     * Generate human-readable model name from filename
     */
    private generateModelName(filename: string): string {
        // Remove extension and common suffixes
        let name = filename
            .replace('.gguf', '')
            .replace(/-GGUF$/i, '')
            .replace(/_/g, ' ')
            .replace(/-/g, ' ');

        // Capitalize first letter of each word
        name = name.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');

        return name;
    }

    /**
     * Get all imported models
     */
    async getImportedModels(): Promise<ImportedModel[]> {
        await this.loadImportedModels();

        // Verify each model still exists
        const validModels: ImportedModel[] = [];
        for (const model of this.importedModels) {
            const exists = await FileSystem.getInfoAsync(model.path);
            if (exists.exists) {
                validModels.push(model);
            }
        }

        // Update registry if models were removed
        if (validModels.length !== this.importedModels.length) {
            this.importedModels = validModels;
            await this.saveImportedModels();
        }

        return validModels;
    }

    /**
     * Get a specific imported model
     */
    async getImportedModel(modelId: string): Promise<ImportedModel | null> {
        await this.loadImportedModels();
        return this.importedModels.find(m => m.id === modelId) ?? null;
    }

    /**
     * Delete an imported model
     */
    async deleteImportedModel(modelId: string): Promise<boolean> {
        try {
            const model = this.importedModels.find(m => m.id === modelId);
            if (!model) return false;

            // Delete file
            await FileSystem.deleteAsync(model.path, { idempotent: true });

            // Remove from registry
            this.importedModels = this.importedModels.filter(m => m.id !== modelId);
            await this.saveImportedModels();

            return true;
        } catch (error) {
            console.error('Delete error:', error);
            return false;
        }
    }

    /**
     * Scan Downloads folder for GGUF files
     */
    async scanDownloadsFolder(): Promise<string[]> {
        if (Platform.OS !== 'android') {
            return []; // Downloads folder access is Android-specific
        }

        try {
            // Try to access common download locations
            const downloadPaths = [
                '/storage/emulated/0/Download',
                '/sdcard/Download',
                '/storage/emulated/0/Downloads',
            ];

            const ggufFiles: string[] = [];

            for (const downloadPath of downloadPaths) {
                try {
                    const info = await FileSystem.getInfoAsync(downloadPath);
                    if (info.exists && info.isDirectory) {
                        const files = await FileSystem.readDirectoryAsync(downloadPath);
                        for (const file of files) {
                            if (file.endsWith('.gguf')) {
                                ggufFiles.push(`${downloadPath}/${file}`);
                            }
                        }
                    }
                } catch {
                    // Path not accessible, skip
                }
            }

            return ggufFiles;
        } catch (error) {
            console.error('Scan error:', error);
            return [];
        }
    }

    /**
     * Import from a specific path (for Downloads folder integration)
     */
    async importFromPath(path: string): Promise<ImportResult> {
        try {
            const info = await FileSystem.getInfoAsync(path);
            if (!info.exists) {
                return { success: false, error: 'File not found' };
            }

            const filename = path.split('/').pop() ?? 'unknown.gguf';
            const modelId = `imported-${Date.now()}`;
            const targetPath = `${getModelsDir()}/${filename}`;

            return this.importFile(path, targetPath, filename, modelId);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Import failed'
            };
        }
    }

    /**
     * Get storage info
     */
    async getStorageInfo(): Promise<{
        modelsDirectory: string;
        totalModels: number;
        totalSize: number;
        freeSpace: number;
    }> {
        await this.loadImportedModels();

        let totalSize = 0;
        for (const model of this.importedModels) {
            totalSize += model.size;
        }

        // Get free space (this is approximate on JS side)
        const freeSpace = await FileSystem.getFreeDiskStorageAsync();

        return {
            modelsDirectory: getModelsDir(),
            totalModels: this.importedModels.length,
            totalSize,
            freeSpace,
        };
    }
}

export const externalModelImport = new ExternalModelImportService();
export default externalModelImport;
