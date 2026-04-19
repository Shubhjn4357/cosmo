/**
 * Cosmo App - Voice Input Component
 * Records audio and transcribes using server API
 */

import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Animated,
    Alert,
    Platform,
} from 'react-native';
import {
    useAudioRecorder,
    useAudioRecorderState,
    RecordingPresets,
    requestRecordingPermissionsAsync,
    getRecordingPermissionsAsync
} from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { FormDataValue } from '@/types';

const API_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-Cosmo-ai.hf.space';

interface VoiceInputProps {
    onTranscript: (text: string) => void;
    onError?: (error: string) => void;
    disabled?: boolean;
}

export function VoiceInput({ onTranscript, onError, disabled = false }: VoiceInputProps) {
    const { theme, isDark } = useTheme();
    const [isTranscribing, setIsTranscribing] = useState(false);
    const pulseAnim = useRef(new Animated.Value(1)).current;

    // Use the expo-audio recorder hook
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const recorderState = useAudioRecorderState(recorder);

    // Pulse animation while recording
    useEffect(() => {
        if (recorderState.isRecording) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.2,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [recorderState.isRecording]);

    const startRecording = async () => {
        try {
            // Check and request permissions
            const { granted } = await getRecordingPermissionsAsync();
            if (!granted) {
                const { granted: requestGranted } = await requestRecordingPermissionsAsync();
                if (!requestGranted) {
                    Alert.alert('Permission Required', 'Please grant microphone access to use voice input');
                    return;
                }
            }

            // Prepare and start recording
            await recorder.prepareToRecordAsync();
            recorder.record();

        } catch (error: unknown) {
            console.error('Failed to start recording:', error);
            onError?.('Failed to start recording');
        }
    };

    const stopRecording = async () => {
        if (!recorderState.isRecording) return;

        setIsTranscribing(true);

        try {
            await recorder.stop();

            // Get the URI from the recorder after stopping
            const uri = recorder.uri;

            if (uri) {
                await transcribeAudio(uri);
            }
        } catch (error) {
            console.error('Failed to stop recording:', error);
            onError?.('Failed to process recording');
        } finally {
            setIsTranscribing(false);
        }
    };

    const transcribeAudio = async (uri: string) => {
        try {
            const formData = new FormData();
            const fileData = {
                uri,
                type: 'audio/m4a',
                name: 'recording.m4a',
            };
            formData.append('audio', fileData as any);

            const response = await fetch(`${API_URL}/api/voice/transcribe`, {
                method: 'POST',
                body: formData,
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });

            if (!response.ok) {
                throw new Error('Transcription failed');
            }

            const data = await response.json();
            if (data.success && data.text) {
                onTranscript(data.text);
            } else {
                onError?.('No speech detected');
            }

        } catch (error: unknown) {
            console.error('Transcription error:', error);
            onError?.('Failed to transcribe audio');
        }
    };

    const handlePress = () => {
        if (disabled || isTranscribing) return;
        
        if (recorderState.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const buttonColor = recorderState.isRecording
        ? theme.colors.error
        : isTranscribing
            ? theme.colors.warning
            : theme.colors.primary;

    return (
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
                style={[
                    styles.button,
                    {
                        backgroundColor: buttonColor + '20',
                        borderColor: buttonColor,
                    },
                    disabled && styles.disabled,
                ]}
                onPress={handlePress}
                disabled={disabled || isTranscribing}
                activeOpacity={0.7}
            >
                <Ionicons
                    name={recorderState.isRecording ? 'stop' : isTranscribing ? 'hourglass-outline' : 'mic'}
                    size={24}
                    color={buttonColor}
                />
            </TouchableOpacity>
            {recorderState.isRecording && (
                <View style={styles.recordingIndicator}>
                    <View style={[styles.recordingDot, { backgroundColor: theme.colors.error }]} />
                    <Text style={[styles.recordingText, { color: theme.colors.error }]}>
                        Recording...
                    </Text>
                </View>
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    button: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabled: {
        opacity: 0.5,
    },
    recordingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        position: 'absolute',
        bottom: -20,
        left: -10,
        gap: 4,
    },
    recordingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    recordingText: {
        fontSize: fontSize.xs,
        fontWeight: '600',
    },
});

export default VoiceInput;
