/**
 * Whisper App - Background Model Manager
 * Handles background downloads, model conversion, notifications, and cleanup
 * 
 * Features:
 * - Background downloads that continue when app is closed
 * - Progress notifications
 * - Automatic model conversion after download
 * - Storage cleanup (removes garbage files)
 * - Optimized storage management
 */

import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Task names
const DOWNLOAD_TASK = 'MODEL_DOWNLOAD_TASK';
const CONVERSION_TASK = 'MODEL_CONVERSION_TASK';
const CLEANUP_TASK = 'MODEL_CLEANUP_TASK';

// Storage keys
const DOWNLOAD_QUEUE_KEY = 'model_download_queue';
const CONVERSION_QUEUE_KEY = 'model_conversion_queue';
const DOWNLOAD_PROGRESS_KEY = 'model_download_progress';

// Directories
const MODELS_DIR = `${FileSystem.documentDirectory}local_image_models`;
const TEMP_DIR = `${FileSystem.cacheDirectory}model_temp`;

export interface ModelDownloadTask {
    id: string;
    modelId: string;
    modelName: string;
    url: string;
    destination: string;
    status: 'pending' | 'downloading' | 'converting' | 'completed' | 'failed';
    progress: number;
    error?: string;
    createdAt: number;
    size?: number;
}

interface DownloadProgress {
    [modelId: string]: {
        progress: number;
        status: string;
        notificationId?: string;
    };
}

class BackgroundModelManager {
    private isInitialized = false;
    private downloadProgress: DownloadProgress = {};
    private activeDownloads: Map<string, FileSystem.DownloadResumable> = new Map();

    /**
     * Initialize background tasks and notifications
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        // Setup notifications
        await this.setupNotifications();

        // Ensure directories exist
        await this.ensureDirectories();

        // Register background tasks
        await this.registerBackgroundTasks();

        // Resume any interrupted downloads
        await this.resumeInterruptedDownloads();

        this.isInitialized = true;
        console.log('BackgroundModelManager initialized');
    }

    /**
     * Setup notification permissions and handlers
     */
    private async setupNotifications(): Promise<void> {
        // Request permissions
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
            console.warn('Notification permissions not granted');
        }

        // Configure notification behavior
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldPlaySound: false,
                shouldSetBadge: false,
                shouldShowBanner: true,
                shouldShowList: true,
            }),
        });
    }

    /**
     * Ensure required directories exist
     */
    private async ensureDirectories(): Promise<void> {
        for (const dir of [MODELS_DIR, TEMP_DIR]) {
            const info = await FileSystem.getInfoAsync(dir);
            if (!info.exists) {
                await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
            }
        }
    }

    /**
     * Register background tasks
     */
    private async registerBackgroundTasks(): Promise<void> {
        // Define download task
        TaskManager.defineTask(DOWNLOAD_TASK, async ({ data, error }) => {
            if (error) {
                console.error('Download task error:', error);
                return BackgroundFetch.BackgroundFetchResult.Failed;
            }
            
            await this.processDownloadQueue();
            return BackgroundFetch.BackgroundFetchResult.NewData;
        });

        // Define cleanup task
        TaskManager.defineTask(CLEANUP_TASK, async () => {
            await this.cleanupTempFiles();
            return BackgroundFetch.BackgroundFetchResult.NewData;
        });

        // Register background fetch for downloads
        try {
            await BackgroundFetch.registerTaskAsync(DOWNLOAD_TASK, {
                minimumInterval: 60, // 1 minute minimum
                stopOnTerminate: false, // Continue when app is closed
                startOnBoot: true, // Resume after device restart
            });
        } catch (e) {
            console.log('Background fetch registration failed (may already be registered):', e);
        }
    }

    /**
     * Resume interrupted downloads on app start
     */
    private async resumeInterruptedDownloads(): Promise<void> {
        const queue = await this.getDownloadQueue();
        const pendingDownloads = queue.filter(
            t => t.status === 'downloading' || t.status === 'pending'
        );

        for (const task of pendingDownloads) {
            console.log(`Resuming download: ${task.modelName}`);
            this.startDownload(task);
        }
    }

    /**
     * Add a model to the download queue
     */
    async queueDownload(
        modelId: string,
        modelName: string,
        downloadUrl: string,
        filename: string
    ): Promise<string> {
        const taskId = `${modelId}_${Date.now()}`;
        const destination = `${MODELS_DIR}/${modelId}/${filename}`;

        const task: ModelDownloadTask = {
            id: taskId,
            modelId,
            modelName,
            url: downloadUrl,
            destination,
            status: 'pending',
            progress: 0,
            createdAt: Date.now(),
        };

        // Add to queue
        const queue = await this.getDownloadQueue();
        queue.push(task);
        await AsyncStorage.setItem(DOWNLOAD_QUEUE_KEY, JSON.stringify(queue));

        // Show notification
        await this.showProgressNotification(modelId, modelName, 0, 'Starting download...');

        // Start download immediately
        this.startDownload(task);

        return taskId;
    }

    /**
     * Start or resume a download
     */
    private async startDownload(task: ModelDownloadTask): Promise<void> {
        const resumeKey = `download_resume_${task.modelId}`;

        try {
            // Check for existing resume data
            const resumeData = await AsyncStorage.getItem(resumeKey);
            
            // Ensure destination directory exists
            const destDir = task.destination.substring(0, task.destination.lastIndexOf('/'));
            const dirInfo = await FileSystem.getInfoAsync(destDir);
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
            }

            // Create download resumable
            let downloadResumable: FileSystem.DownloadResumable;
            
            const progressCallback = (downloadProgress: FileSystem.DownloadProgressData) => {
                const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
                this.updateProgress(task.modelId, task.modelName, progress, 'Downloading...');
            };

            if (resumeData) {
                try {
                    const parsedData = JSON.parse(resumeData);
                    downloadResumable = new FileSystem.DownloadResumable(
                        task.url,
                        task.destination,
                        {},
                        progressCallback,
                        parsedData
                    );
                } catch {
                    await AsyncStorage.removeItem(resumeKey);
                    downloadResumable = FileSystem.createDownloadResumable(
                        task.url,
                        task.destination,
                        {},
                        progressCallback
                    );
                }
            } else {
                downloadResumable = FileSystem.createDownloadResumable(
                    task.url,
                    task.destination,
                    {},
                    progressCallback
                );
            }

            this.activeDownloads.set(task.modelId, downloadResumable);

            // Update status
            await this.updateTaskStatus(task.id, 'downloading');

            // Start download
            const result = await downloadResumable.downloadAsync();

            if (result && result.status === 200) {
                // Download complete
                await this.updateTaskStatus(task.id, 'completed', 1);
                await AsyncStorage.removeItem(resumeKey);
                this.activeDownloads.delete(task.modelId);

                // Show completion notification
                await this.showCompletionNotification(task.modelId, task.modelName);

                // Queue for conversion if needed
                await this.queueConversion(task.modelId, task.destination);

                // Cleanup temp files
                await this.cleanupTempFiles();

            } else {
                throw new Error(`Download failed with status: ${result?.status}`);
            }

        } catch (error: any) {
            console.error(`Download failed for ${task.modelId}:`, error);

            // Save resume data for later
            const download = this.activeDownloads.get(task.modelId);
            if (download) {
                try {
                    const resumeData = await download.pauseAsync();
                    await AsyncStorage.setItem(resumeKey, JSON.stringify(resumeData));
                } catch {}
            }

            await this.updateTaskStatus(task.id, 'failed', 0, error.message);
            await this.showErrorNotification(task.modelId, task.modelName, error.message);
        }
    }

    /**
     * Update download progress and notification
     */
    private async updateProgress(
        modelId: string,
        modelName: string,
        progress: number,
        status: string
    ): Promise<void> {
        this.downloadProgress[modelId] = {
            progress,
            status,
            notificationId: this.downloadProgress[modelId]?.notificationId,
        };

        // Update notification (throttled to every 5%)
        const lastProgress = this.downloadProgress[modelId]?.progress || 0;
        if (Math.floor(progress * 20) > Math.floor(lastProgress * 20)) {
            await this.showProgressNotification(modelId, modelName, progress, status);
        }

        // Save progress to storage
        await AsyncStorage.setItem(DOWNLOAD_PROGRESS_KEY, JSON.stringify(this.downloadProgress));
    }

    /**
     * Show progress notification
     */
    private async showProgressNotification(
        modelId: string,
        modelName: string,
        progress: number,
        status: string
    ): Promise<void> {
        const notificationId = `download_${modelId}`;

        await Notifications.scheduleNotificationAsync({
            identifier: notificationId,
            content: {
                title: `Downloading ${modelName}`,
                body: `${Math.round(progress * 100)}% - ${status}`,
                data: { modelId, type: 'download' },
                // Android progress bar
                ...(Platform.OS === 'android' && {
                    // @ts-ignore - Android specific
                    progress: progress,
                }),
            },
            trigger: null, // Immediate
        });

        this.downloadProgress[modelId] = {
            ...this.downloadProgress[modelId],
            notificationId,
        };
    }

    /**
     * Show completion notification
     */
    private async showCompletionNotification(modelId: string, modelName: string): Promise<void> {
        // Dismiss progress notification
        await Notifications.dismissNotificationAsync(`download_${modelId}`);

        // Show completion
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '✅ Download Complete',
                body: `${modelName} is ready to use`,
                data: { modelId, type: 'complete' },
            },
            trigger: null,
        });
    }

    /**
     * Show error notification
     */
    private async showErrorNotification(
        modelId: string,
        modelName: string,
        error: string
    ): Promise<void> {
        await Notifications.dismissNotificationAsync(`download_${modelId}`);

        await Notifications.scheduleNotificationAsync({
            content: {
                title: '❌ Download Failed',
                body: `${modelName}: ${error}`,
                data: { modelId, type: 'error' },
            },
            trigger: null,
        });
    }

    /**
     * Queue model for conversion (placeholder for future .pte conversion)
     */
    private async queueConversion(modelId: string, filePath: string): Promise<void> {
        // Note: Actual conversion to .pte format requires native code
        // This is a placeholder for when we implement native conversion
        console.log(`Model ${modelId} ready for conversion: ${filePath}`);
        
        // Mark as completed in queue
        const downloaded = await this.getDownloadedModels();
        if (!downloaded.includes(modelId)) {
            downloaded.push(modelId);
            await AsyncStorage.setItem('downloaded_local_image_models', JSON.stringify(downloaded));
        }
    }

    /**
     * Cleanup temporary and garbage files
     */
    async cleanupTempFiles(): Promise<void> {
        console.log('Cleaning up temporary files...');

        try {
            // Clean temp directory
            const tempInfo = await FileSystem.getInfoAsync(TEMP_DIR);
            if (tempInfo.exists) {
                const files = await FileSystem.readDirectoryAsync(TEMP_DIR);
                for (const file of files) {
                    await FileSystem.deleteAsync(`${TEMP_DIR}/${file}`, { idempotent: true });
                }
            }

            // Clean incomplete downloads (files without corresponding queue entry)
            const queue = await this.getDownloadQueue();
            const modelDir = await FileSystem.getInfoAsync(MODELS_DIR);
            
            if (modelDir.exists) {
                const modelFolders = await FileSystem.readDirectoryAsync(MODELS_DIR);
                
                for (const folder of modelFolders) {
                    const folderPath = `${MODELS_DIR}/${folder}`;
                    const folderInfo = await FileSystem.getInfoAsync(folderPath);
                    
                    if (folderInfo.isDirectory) {
                        // Check if this model has a completed download
                        const isCompleted = queue.some(
                            t => t.modelId === folder && t.status === 'completed'
                        );
                        
                        // Check for partial/temp files
                        const files = await FileSystem.readDirectoryAsync(folderPath);
                        for (const file of files) {
                            // Remove .tmp and .partial files
                            if (file.endsWith('.tmp') || file.endsWith('.partial')) {
                                await FileSystem.deleteAsync(`${folderPath}/${file}`, { idempotent: true });
                                console.log(`Cleaned up: ${file}`);
                            }
                        }
                    }
                }
            }

            // Calculate freed space
            console.log('Cleanup complete');
            
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }

    /**
     * Get storage usage info
     */
    async getStorageInfo(): Promise<{
        modelsSize: number;
        tempSize: number;
        freeSpace: number;
    }> {
        let modelsSize = 0;
        let tempSize = 0;

        try {
            // Calculate models directory size
            const modelDir = await FileSystem.getInfoAsync(MODELS_DIR);
            if (modelDir.exists) {
                modelsSize = await this.getDirectorySize(MODELS_DIR);
            }

            // Calculate temp directory size
            const tempDir = await FileSystem.getInfoAsync(TEMP_DIR);
            if (tempDir.exists) {
                tempSize = await this.getDirectorySize(TEMP_DIR);
            }

            // Get free space (approximate via FileSystem)
            const freeSpace = await FileSystem.getFreeDiskStorageAsync();

            return { modelsSize, tempSize, freeSpace };
        } catch {
            return { modelsSize: 0, tempSize: 0, freeSpace: 0 };
        }
    }

    /**
     * Helper to calculate directory size recursively
     */
    private async getDirectorySize(path: string): Promise<number> {
        let size = 0;
        try {
            const info = await FileSystem.getInfoAsync(path);
            if (!info.exists) return 0;

            if (info.isDirectory) {
                const files = await FileSystem.readDirectoryAsync(path);
                for (const file of files) {
                    size += await this.getDirectorySize(`${path}/${file}`);
                }
            } else {
                size = (info as any).size || 0;
            }
        } catch {}
        return size;
    }

    /**
     * Pause a download
     */
    async pauseDownload(modelId: string): Promise<boolean> {
        const download = this.activeDownloads.get(modelId);
        if (!download) return false;

        try {
            const resumeData = await download.pauseAsync();
            await AsyncStorage.setItem(`download_resume_${modelId}`, JSON.stringify(resumeData));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Cancel and remove a download
     */
    async cancelDownload(modelId: string): Promise<boolean> {
        const download = this.activeDownloads.get(modelId);
        
        try {
            if (download) {
                await download.pauseAsync();
            }

            // Remove from queue
            const queue = await this.getDownloadQueue();
            const updated = queue.filter(t => t.modelId !== modelId);
            await AsyncStorage.setItem(DOWNLOAD_QUEUE_KEY, JSON.stringify(updated));

            // Delete partial files
            const modelDir = `${MODELS_DIR}/${modelId}`;
            await FileSystem.deleteAsync(modelDir, { idempotent: true });

            // Clear resume data
            await AsyncStorage.removeItem(`download_resume_${modelId}`);

            // Dismiss notification
            await Notifications.dismissNotificationAsync(`download_${modelId}`);

            this.activeDownloads.delete(modelId);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get download queue
     */
    private async getDownloadQueue(): Promise<ModelDownloadTask[]> {
        const stored = await AsyncStorage.getItem(DOWNLOAD_QUEUE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    /**
     * Get downloaded models
     */
    private async getDownloadedModels(): Promise<string[]> {
        const stored = await AsyncStorage.getItem('downloaded_local_image_models');
        return stored ? JSON.parse(stored) : [];
    }

    /**
     * Update task status in queue
     */
    private async updateTaskStatus(
        taskId: string,
        status: ModelDownloadTask['status'],
        progress?: number,
        error?: string
    ): Promise<void> {
        const queue = await this.getDownloadQueue();
        const updated = queue.map(t => {
            if (t.id === taskId) {
                return {
                    ...t,
                    status,
                    progress: progress ?? t.progress,
                    error: error ?? t.error,
                };
            }
            return t;
        });
        await AsyncStorage.setItem(DOWNLOAD_QUEUE_KEY, JSON.stringify(updated));
    }

    /**
     * Process download queue (called by background task)
     */
    private async processDownloadQueue(): Promise<void> {
        const queue = await this.getDownloadQueue();
        const pending = queue.filter(t => t.status === 'pending');

        for (const task of pending) {
            await this.startDownload(task);
        }
    }

    /**
     * Get current progress for all downloads
     */
    getProgress(): DownloadProgress {
        return this.downloadProgress;
    }
}

export const backgroundModelManager = new BackgroundModelManager();
export default backgroundModelManager;
