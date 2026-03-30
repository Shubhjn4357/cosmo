/**
 * Whisper App - Training Data Sync Service
 * Backs up training data to HuggingFace Hub
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { whisperAPI } from './api';

const TRAINING_DATA_KEY = 'Whisper_training_data';
const LAST_SYNC_KEY = 'Whisper_last_training_sync';
const DEVICE_ID_KEY = 'Whisper_device_id';

export interface TrainingPair {
    input: string;
    output: string;
    model: string;
    timestamp: string;
    corrected?: boolean;
}

class TrainingSyncService {
    private pendingData: TrainingPair[] = [];
    private syncInterval: ReturnType<typeof setInterval> | null = null;
    private deviceId: string = '';

    constructor() {
        this.initialize();
    }

    /**
     * Initialize the service
     */
    private async initialize() {
        await this.loadPendingData();
        await this.getOrCreateDeviceId();
        this.startAutoSync();
    }

    /**
     * Get or create device ID
     */
    private async getOrCreateDeviceId(): Promise<string> {
        let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
        if (!deviceId) {
            deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
        }
        this.deviceId = deviceId;
        return deviceId;
    }

    /**
     * Load pending training data from storage
     */
    private async loadPendingData() {
        try {
            const saved = await AsyncStorage.getItem(TRAINING_DATA_KEY);
            if (saved) {
                this.pendingData = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Error loading training data:', error);
        }
    }

    /**
     * Save pending data to storage
     */
    private async savePendingData() {
        try {
            await AsyncStorage.setItem(TRAINING_DATA_KEY, JSON.stringify(this.pendingData));
        } catch (error) {
            console.error('Error saving training data:', error);
        }
    }

    /**
     * Add a training pair (from chat interaction)
     */
    async addTrainingPair(input: string, output: string, model: string = 'default') {
        const pair: TrainingPair = {
            input,
            output,
            model,
            timestamp: new Date().toISOString(),
        };

        this.pendingData.push(pair);
        await this.savePendingData();
    }

    /**
     * Add a corrected response (user feedback)
     */
    async addCorrection(input: string, correctedOutput: string, originalOutput: string, model: string = 'default') {
        // Add the correction as high-priority training data
        const pair: TrainingPair = {
            input,
            output: correctedOutput,
            model,
            timestamp: new Date().toISOString(),
            corrected: true,
        };

        this.pendingData.push(pair);
        await this.savePendingData();

        // Also submit correction to server immediately
        try {
            await whisperAPI.submitCorrection(input, correctedOutput, originalOutput);
        } catch (error) {
            console.error('Error submitting correction:', error);
        }
    }

    /**
     * Start auto-sync (every 10 minutes)
     */
    private startAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        // Sync every 10 minutes
        this.syncInterval = setInterval(() => {
            this.syncToServer();
        }, 10 * 60 * 1000);
    }

    /**
     * Stop auto-sync
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * Sync training data to server
     */
    async syncToServer(): Promise<{ success: boolean; synced: number }> {
        if (this.pendingData.length === 0) {
            return { success: true, synced: 0 };
        }

        try {
            const pairs = this.pendingData.map(p => ({
                input: p.input,
                output: p.output,
                model: p.model,
            }));

            const result = await whisperAPI.syncTrainingData(pairs, this.deviceId);

            if (result.status === 'ok' || result.synced > 0) {
                // Clear synced data
                this.pendingData = [];
                await this.savePendingData();
                await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

                return { success: true, synced: result.synced };
            }

            return { success: false, synced: 0 };
        } catch (error) {
            console.error('Error syncing training data:', error);
            return { success: false, synced: 0 };
        }
    }

    /**
     * Get last sync time
     */
    async getLastSyncTime(): Promise<string | null> {
        return await AsyncStorage.getItem(LAST_SYNC_KEY);
    }

    /**
     * Get pending data count
     */
    getPendingCount(): number {
        return this.pendingData.length;
    }

    /**
     * Manual sync trigger
     */
    async forceSync(): Promise<{ success: boolean; synced: number }> {
        return await this.syncToServer();
    }

    /**
     * Clear all pending data (for privacy)
     */
    async clearPendingData() {
        this.pendingData = [];
        await this.savePendingData();
    }

    /**
     * Export training data for manual backup
     */
    async exportData(): Promise<string> {
        return JSON.stringify(this.pendingData, null, 2);
    }
}

// Note: This is already exported by trainingSync.ts, but we're enhancing it
export const trainingSyncService = new TrainingSyncService();
