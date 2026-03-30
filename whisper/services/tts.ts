/**
 * Whisper App - Text-to-Speech Service
 * English TTS for AI responses
 */

import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TTS_SETTINGS_KEY = '@whisper_tts_settings';

interface TTSOptions {
    language?: string;
    pitch?: number;
    rate?: number;
    onStart?: () => void;
    onDone?: () => void;
    onError?: (error: any) => void;
}

export type VoiceType = 'male' | 'female';

export interface TTSSettings {
    voice: VoiceType;
    pitch: number;
}

const DEFAULT_SETTINGS: TTSSettings = {
    voice: 'female',
    pitch: 1.0,
};

class TextToSpeechService {
    private isSpeaking: boolean = false;
    private currentText: string = '';
    private settings: TTSSettings = DEFAULT_SETTINGS;
    private settingsLoaded = false;

    private async ensureSettingsLoaded() {
        if (this.settingsLoaded) {
            return;
        }

        try {
            const raw = await AsyncStorage.getItem(TTS_SETTINGS_KEY);
            if (raw) {
                this.settings = {
                    ...DEFAULT_SETTINGS,
                    ...JSON.parse(raw),
                };
            }
        } catch (error) {
            console.error('Failed to load TTS settings:', error);
        } finally {
            this.settingsLoaded = true;
        }
    }

    getSettings(): TTSSettings {
        return this.settings;
    }

    async saveSettings(settings: TTSSettings) {
        this.settings = settings;
        this.settingsLoaded = true;
        await AsyncStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(settings));
    }

    /**
     * Speak text using device TTS
     */
    async speak(text: string, options: TTSOptions = {}) {
        await this.ensureSettingsLoaded();

        // Stop any ongoing speech
        await this.stop();

        this.isSpeaking = true;
        this.currentText = text;

        const defaultOptions: Speech.SpeechOptions = {
            language: options.language || 'en-US',
            pitch: options.pitch || this.settings.pitch,
            rate: options.rate || 0.9, // Slightly slower for clarity
            onStart: () => {
                this.isSpeaking = true;
                options.onStart?.();
            },
            onDone: () => {
                this.isSpeaking = false;
                this.currentText = '';
                options.onDone?.();
            },
            onError: (error) => {
                this.isSpeaking = false;
                this.currentText = '';
                options.onError?.(error);
            },
        };

        try {
            await Speech.speak(text, defaultOptions);
        } catch (error) {
            console.error('TTS Error:', error);
            this.isSpeaking = false;
            options.onError?.(error);
        }
    }

    /**
     * Stop current speech
     */
    async stop() {
        if (this.isSpeaking) {
            await Speech.stop();
            this.isSpeaking = false;
            this.currentText = '';
        }
    }

    /**
     * Pause current speech (iOS only)
     */
    async pause() {
        if (this.isSpeaking) {
            await Speech.pause();
        }
    }

    /**
     * Resume paused speech (iOS only)
     */
    async resume() {
        await Speech.resume();
    }

    /**
     * Check if currently speaking
     */
    getIsSpeaking(): boolean {
        return this.isSpeaking;
    }

    /**
     * Get available voices
     */
    async getVoices() {
        try {
            return await Speech.getAvailableVoicesAsync();
        } catch {
            return [];
        }
    }

    /**
     * Check if TTS is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            const voices = await this.getVoices();
            return voices.length > 0;
        } catch {
            return false;
        }
    }
}

// Singleton instance
export const ttsService = new TextToSpeechService();

// Hook for React components
import { useState, useCallback } from 'react';

export function useTTS() {
    const [isSpeaking, setIsSpeaking] = useState(false);

    const speak = useCallback(async (text: string) => {
        await ttsService.speak(text, {
            onStart: () => setIsSpeaking(true),
            onDone: () => setIsSpeaking(false),
            onError: () => setIsSpeaking(false),
        });
    }, []);

    const stop = useCallback(async () => {
        await ttsService.stop();
        setIsSpeaking(false);
    }, []);

    const toggle = useCallback(async (text: string) => {
        if (isSpeaking) {
            await stop();
        } else {
            await speak(text);
        }
    }, [isSpeaking, speak, stop]);

    return {
        isSpeaking,
        speak,
        stop,
        toggle,
    };
}
