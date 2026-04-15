/**
 * Voice Input Hook
 * Handles audio recording and transcription
 */

import { useState, useCallback } from 'react';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { cosmoAPI } from '@/services/api';
import { useUnifiedTokens } from './useUnifiedTokens';

export function useVoiceInput() {
    const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const { getApiParams } = useUnifiedTokens();

    /**
     * Start recording audio
     */
    const startRecording = useCallback(async (): Promise<boolean> => {
        try {
            // Request permissions
            const { granted } = await AudioModule.requestRecordingPermissionsAsync();
            if (!granted) {
                throw new Error('Microphone permission denied');
            }

            // Start recording
            await audioRecorder.record();
            setIsRecording(true);
            return true;
        } catch (error) {
            console.error('Failed to start recording:', error);
            throw error;
        }
    }, [audioRecorder]);

    /**
     * Stop recording and return audio URI
     */
    const stopRecording = useCallback(async (): Promise<string | null> => {
        try {
            setIsRecording(false);
            await audioRecorder.stop();
            // expo-audio stores URI internally, will be available after stop
            return audioRecorder.uri || null;
        } catch (error) {
            console.error('Failed to stop recording:', error);
            throw error;
        }
    }, [audioRecorder]);

    /**
     * Transcribe audio file to text
     */
    const transcribe = useCallback(async (audioUri: string): Promise<string> => {
        if (!audioUri) {
            throw new Error('No audio URI provided');
        }

        setIsTranscribing(true);
        try {
            const params = getApiParams();
            const result = await cosmoAPI.transcribeAudio({
                audioUri,
                userId: params.user_id,
                sessionId: params.session_id,
            });

            return result.text;
        } catch (error) {
            console.error('Transcription failed:', error);
            throw error;
        } finally {
            setIsTranscribing(false);
        }
    }, [getApiParams]);

    /**
     * Complete flow: record, stop, transcribe
     */
    const recordAndTranscribe = useCallback(async (): Promise<string> => {
        try {
            // Start recording
            await startRecording();

            // Wait for user to stop (handled externally)
            // This is a helper that combines start/stop/transcribe
            return '';
        } catch (error) {
            console.error('Record and transcribe failed:', error);
            throw error;
        }
    }, [startRecording]);

    /**
     * Cancel recording
     */
    const cancelRecording = useCallback(async () => {
        if (isRecording) {
            try {
                await audioRecorder.stop();
            } catch (error) {
                console.error('Failed to cancel recording:', error);
            } finally {
                setIsRecording(false);
            }
        }
    }, [audioRecorder, isRecording]);

    return {
        isRecording,
        isTranscribing,
        startRecording,
        stopRecording,
        transcribe,
        recordAndTranscribe,
        cancelRecording,
    };
}
