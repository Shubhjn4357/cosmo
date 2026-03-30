/**
 * Whisper App - Data Collection Service
 * Privacy-compliant usage data collection with consent
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { whisperAPI } from './api';

const CONSENT_KEY = 'Whisper_data_collection_consent';
const USAGE_DATA_KEY = 'Whisper_usage_data';
const LAST_UPLOAD_KEY = 'Whisper_last_data_upload';

export interface UsageEvent {
    type: 'chat' | 'image' | 'file' | 'model_download' | 'app_open' | 'feature_use';
    action: string;
    metadata?: Record<string, any>;
    timestamp: string;
}

class DataCollectionService {
    private events: UsageEvent[] = [];
    private hasConsent: boolean = false;
    private userId: string | null = null;

    constructor() {
        this.loadState();
    }

    /**
     * Load saved state
     */
    private async loadState() {
        try {
            const consent = await AsyncStorage.getItem(CONSENT_KEY);
            this.hasConsent = consent === 'true';

            if (this.hasConsent) {
                const saved = await AsyncStorage.getItem(USAGE_DATA_KEY);
                if (saved) {
                    this.events = JSON.parse(saved);
                }
            }
        } catch (error) {
            console.error('Error loading data collection state:', error);
        }
    }

    /**
     * Save events to storage
     */
    private async saveEvents() {
        try {
            await AsyncStorage.setItem(USAGE_DATA_KEY, JSON.stringify(this.events));
        } catch (error) {
            console.error('Error saving usage events:', error);
        }
    }

    /**
     * Set user consent for data collection
     */
    async setConsent(consent: boolean) {
        this.hasConsent = consent;
        await AsyncStorage.setItem(CONSENT_KEY, consent ? 'true' : 'false');

        if (!consent) {
            // Clear all collected data if consent is revoked
            this.events = [];
            await AsyncStorage.removeItem(USAGE_DATA_KEY);
        }
    }

    /**
     * Check if user has given consent
     */
    async hasDataConsent(): Promise<boolean> {
        const consent = await AsyncStorage.getItem(CONSENT_KEY);
        return consent === 'true';
    }

    /**
     * Set user ID for data association
     */
    setUserId(userId: string | null) {
        this.userId = userId;
    }

    /**
     * Track a usage event
     */
    async trackEvent(type: UsageEvent['type'], action: string, metadata?: Record<string, any>) {
        if (!this.hasConsent) return;

        const event: UsageEvent = {
            type,
            action,
            metadata: {
                ...metadata,
                userId: this.userId,
            },
            timestamp: new Date().toISOString(),
        };

        this.events.push(event);
        await this.saveEvents();

        // Auto-upload if we have enough events
        if (this.events.length >= 50) {
            await this.uploadToServer();
        }
    }

    /**
     * Track chat interaction
     */
    async trackChat(messageLength: number, responseLength: number, model: string, isLocal: boolean) {
        await this.trackEvent('chat', 'message_sent', {
            messageLength,
            responseLength,
            model,
            isLocal,
        });
    }

    /**
     * Track image generation
     */
    async trackImageGeneration(promptLength: number, model: string, success: boolean) {
        await this.trackEvent('image', 'image_generated', {
            promptLength,
            model,
            success,
        });
    }

    /**
     * Track file analysis
     */
    async trackFileAnalysis(fileType: string, fileSize: number, success: boolean) {
        await this.trackEvent('file', 'file_analyzed', {
            fileType,
            fileSize,
            success,
        });
    }

    /**
     * Track model download
     */
    async trackModelDownload(modelId: string, modelSize: number, success: boolean) {
        await this.trackEvent('model_download', 'model_downloaded', {
            modelId,
            modelSize,
            success,
        });
    }

    /**
     * Track feature usage
     */
    async trackFeatureUse(feature: string) {
        await this.trackEvent('feature_use', feature);
    }

    /**
     * Track app open
     */
    async trackAppOpen() {
        await this.trackEvent('app_open', 'app_launched');
    }

    /**
     * Upload collected data to server
     */
    async uploadToServer(): Promise<boolean> {
        if (!this.hasConsent || this.events.length === 0) {
            return true;
        }

        try {
            // Send to server (you'd implement a specific endpoint for this)
            const response = await fetch(`${process.env.EXPO_PUBLIC_API_BASE_URL}/analytics/collect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    events: this.events,
                    deviceId: await this.getDeviceId(),
                }),
            });

            if (response.ok) {
                this.events = [];
                await this.saveEvents();
                await AsyncStorage.setItem(LAST_UPLOAD_KEY, new Date().toISOString());
                return true;
            }

            return false;
        } catch (error) {
            console.error('Error uploading analytics:', error);
            return false;
        }
    }

    /**
     * Get device ID for analytics
     */
    private async getDeviceId(): Promise<string> {
        let deviceId = await AsyncStorage.getItem('Whisper_analytics_device_id');
        if (!deviceId) {
            deviceId = `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await AsyncStorage.setItem('Whisper_analytics_device_id', deviceId);
        }
        return deviceId;
    }

    /**
     * Get pending events count
     */
    getPendingCount(): number {
        return this.events.length;
    }

    /**
     * Force upload now
     */
    async forceUpload(): Promise<boolean> {
        return await this.uploadToServer();
    }

    /**
     * Get last upload time
     */
    async getLastUploadTime(): Promise<string | null> {
        return await AsyncStorage.getItem(LAST_UPLOAD_KEY);
    }
}

// Singleton instance
export const dataCollection = new DataCollectionService();
