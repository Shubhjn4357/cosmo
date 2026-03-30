/**
 * Whisper AI - Image Upscale Screen
 * UI for upscaling images to 2K/4K resolution
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Image,
    ActivityIndicator,
    ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { whisperAPI } from '@/services/api';
import { useToast } from '@/components/Toast';
import { AuthGate } from '@/components/AuthGate';

type UpscalePreset = '2x' | '4x' | '2k' | '4k';

interface UpscaleResult {
    result_url: string;
    original_size: [number, number];
    upscaled_size: [number, number];
    scale_factor: number;
    message: string;
}

interface SelectedImage {
    uri: string;
    base64: string;
}

const PRESETS: { id: UpscalePreset; label: string; description: string }[] = [
    { id: '2x', label: '2x', description: 'Double resolution' },
    { id: '4x', label: '4x', description: 'Quadruple resolution' },
    { id: '2k', label: '2K', description: '2048 × 2048' },
    { id: '4k', label: '4K', description: '3840 × 2160' },
];

// Wrapper for auth protection
export default function UpscaleScreenWrapper() {
    return (
        <AuthGate feature="Image Upscale">
            <UpscaleScreen />
        </AuthGate>
    );
}

function UpscaleScreen() {
    const { theme } = useTheme();
    const toast = useToast();

    // Image state
    const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
    const [resultImage, setResultImage] = useState<string | null>(null);
    const [resultInfo, setResultInfo] = useState<UpscaleResult | null>(null);

    // Settings
    const [preset, setPreset] = useState<UpscalePreset>('2x');

    // Processing state
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Pick an image from gallery
     */
    const pickImage = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: false,
                quality: 1,
                base64: true,
            });

            if (!result.canceled && result.assets[0] && result.assets[0].base64) {
                setSelectedImage({
                    uri: result.assets[0].uri,
                    base64: result.assets[0].base64,
                });
                setResultImage(null);
                setResultInfo(null);
                setError(null);
            }
        } catch (err) {
            toast.error('Error', 'Failed to pick image');
        }
    };

    /**
     * Perform upscaling
     */
    const performUpscale = async () => {
        if (!selectedImage) {
            toast.error('Error', 'Please select an image first');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setResultImage(null);
        setResultInfo(null);

        try {
            // Call API with base64 data
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/upscale`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image: selectedImage.base64,
                    preset: preset,
                    model: 'realesrgan',
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Upscaling failed');
            }

            const result: UpscaleResult = await response.json();

            // Construct full URL
            const resultUrl = result.result_url.startsWith('http')
                ? result.result_url
                : `${whisperAPI.getBaseUrl()}${result.result_url}`;

            setResultImage(resultUrl);
            setResultInfo(result);
            toast.success('Success', `Upscaled ${result.scale_factor}x!`);

        } catch (err) {
            const message = err instanceof Error ? err.message : 'Upscaling failed';
            setError(message);
            toast.error('Error', message);
        } finally {
            setIsProcessing(false);
        }
    };

    /**
     * Reset
     */
    const reset = () => {
        setSelectedImage(null);
        setResultImage(null);
        setResultInfo(null);
        setError(null);
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        🔍 Upscale Image
                    </Text>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        Enhance images to 2K or 4K resolution
                    </Text>
                </View>

                {/* Image Selection */}
                <TouchableOpacity
                    style={[styles.imagePicker, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}
                    onPress={pickImage}
                >
                    {selectedImage ? (
                        <Image source={{ uri: selectedImage.uri }} style={styles.selectedImage} resizeMode="contain" />
                    ) : (
                        <View style={styles.placeholderContent}>
                            <Ionicons name="image-outline" size={64} color={theme.colors.textMuted} />
                            <Text style={[styles.placeholderText, { color: theme.colors.textMuted }]}>
                                Tap to select an image
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>

                {/* Preset Selection */}
                <Text style={[styles.sectionLabel, { color: theme.colors.text }]}>
                    Upscale Preset
                </Text>
                <View style={styles.presetsRow}>
                    {PRESETS.map((p) => (
                        <TouchableOpacity
                            key={p.id}
                            style={[
                                styles.presetButton,
                                { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder },
                                preset === p.id && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '20' }
                            ]}
                            onPress={() => setPreset(p.id)}
                        >
                            <Text style={[
                                styles.presetLabel,
                                { color: preset === p.id ? theme.colors.primary : theme.colors.text }
                            ]}>
                                {p.label}
                            </Text>
                            <Text style={[styles.presetDesc, { color: theme.colors.textMuted }]}>
                                {p.description}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Upscale Button */}
                <TouchableOpacity
                    style={[
                        styles.upscaleButton,
                        { backgroundColor: theme.colors.primary },
                        (!selectedImage || isProcessing) && styles.buttonDisabled
                    ]}
                    onPress={performUpscale}
                    disabled={!selectedImage || isProcessing}
                >
                    {isProcessing ? (
                        <View style={styles.processingContainer}>
                            <ActivityIndicator color="#fff" />
                            <Text style={styles.upscaleButtonText}>Upscaling...</Text>
                        </View>
                    ) : (
                        <>
                            <Ionicons name="resize" size={20} color="#fff" />
                            <Text style={styles.upscaleButtonText}>Upscale {preset.toUpperCase()}</Text>
                        </>
                    )}
                </TouchableOpacity>

                {/* Info Card */}
                <View style={[styles.infoCard, { backgroundColor: theme.colors.surface }]}>
                    <Ionicons name="information-circle" size={20} color={theme.colors.primary} />
                    <Text style={[styles.infoText, { color: theme.colors.textSecondary }]}>
                        Uses Real-ESRGAN for best quality. Falls back to HuggingFace API (free, no GPU needed) if not available.
                    </Text>
                </View>

                {/* Error */}
                {error && (
                    <View style={[styles.errorCard, { backgroundColor: theme.colors.error + '20' }]}>
                        <Ionicons name="alert-circle" size={20} color={theme.colors.error} />
                        <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
                    </View>
                )}

                {/* Result */}
                {resultImage && resultInfo && (
                    <View style={styles.resultSection}>
                        <View style={styles.resultHeader}>
                            <Text style={[styles.resultLabel, { color: theme.colors.text }]}>
                                Result
                            </Text>
                            <View style={[styles.resultBadge, { backgroundColor: theme.colors.success + '20' }]}>
                                <Text style={[styles.resultBadgeText, { color: theme.colors.success }]}>
                                    {resultInfo.original_size[0]}×{resultInfo.original_size[1]} → {resultInfo.upscaled_size[0]}×{resultInfo.upscaled_size[1]}
                                </Text>
                            </View>
                        </View>

                        <Image
                            source={{ uri: resultImage }}
                            style={styles.resultImage}
                            resizeMode="contain"
                        />

                        <View style={styles.resultButtons}>
                            <TouchableOpacity
                                style={[styles.resultButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={reset}
                            >
                                <Ionicons name="refresh" size={18} color={theme.colors.text} />
                                <Text style={[styles.resultButtonText, { color: theme.colors.text }]}>New</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: spacing.lg,
    },
    header: {
        marginBottom: spacing.xl,
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    subtitle: {
        fontSize: fontSize.md,
        marginTop: spacing.xs,
    },
    imagePicker: {
        height: 200,
        borderRadius: borderRadius.lg,
        borderWidth: 2,
        borderStyle: 'dashed',
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.lg,
    },
    selectedImage: {
        width: '100%',
        height: '100%',
    },
    placeholderContent: {
        alignItems: 'center',
        gap: spacing.sm,
    },
    placeholderText: {
        fontSize: fontSize.md,
    },
    sectionLabel: {
        fontSize: fontSize.md,
        fontWeight: '600',
        marginBottom: spacing.md,
    },
    presetsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    presetButton: {
        flex: 1,
        minWidth: 80,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 2,
        alignItems: 'center',
    },
    presetLabel: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    presetDesc: {
        fontSize: fontSize.xs,
        marginTop: 2,
    },
    upscaleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        marginBottom: spacing.lg,
    },
    buttonDisabled: {
        opacity: 0.5,
    },
    processingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    upscaleButtonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    infoCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.lg,
    },
    infoText: {
        flex: 1,
        fontSize: fontSize.sm,
        lineHeight: 20,
    },
    errorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.lg,
    },
    errorText: {
        flex: 1,
        fontSize: fontSize.sm,
    },
    resultSection: {
        marginTop: spacing.md,
    },
    resultHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
    },
    resultLabel: {
        fontSize: fontSize.lg,
        fontWeight: '600',
    },
    resultBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
    },
    resultBadgeText: {
        fontSize: fontSize.xs,
        fontWeight: '600',
    },
    resultImage: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: borderRadius.lg,
        backgroundColor: '#000',
    },
    resultButtons: {
        flexDirection: 'row',
        gap: spacing.md,
        marginTop: spacing.md,
    },
    resultButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
    },
    resultButtonText: {
        color: '#fff',
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
});
