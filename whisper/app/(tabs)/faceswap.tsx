/**
 * Whisper AI - Face Swap Screen
 * UI for face swapping feature using the server API
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
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { whisperAPI } from '@/services/api';
import { useToast } from '@/components/Toast';
import { AuthGate } from '@/components/AuthGate';

interface FaceSwapResult {
    result_url: string;
    message: string;
}

interface SelectedImage {
    uri: string;
    base64: string;
}


function toDataUrl(base64: string): string {
    return base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
}

// Wrapper for auth protection
export default function FaceSwapScreenWrapper() {
    return (
        <AuthGate feature="Face Swap">
            <FaceSwapScreen />
        </AuthGate>
    );
}

function FaceSwapScreen() {
    const { theme } = useTheme();
    const toast = useToast();

    // Image state
    const [sourceImage, setSourceImage] = useState<SelectedImage | null>(null);
    const [targetImage, setTargetImage] = useState<SelectedImage | null>(null);
    const [resultImage, setResultImage] = useState<string | null>(null);

    // Processing state
    const [isProcessing, setIsProcessing] = useState(false);
    const [enhanceFace, setEnhanceFace] = useState(true);
    const [error, setError] = useState<string | null>(null);

    /**
     * Pick an image from gallery or camera
     */
    const pickImage = async (type: 'source' | 'target') => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
                base64: true,
            });

            if (!result.canceled && result.assets[0] && result.assets[0].base64) {
                const imageData: SelectedImage = {
                    uri: result.assets[0].uri,
                    base64: result.assets[0].base64,
                };
                if (type === 'source') {
                    setSourceImage(imageData);
                } else {
                    setTargetImage(imageData);
                }
                setResultImage(null);
                setError(null);
            }
        } catch (err) {
            toast.error('Error', 'Failed to pick image');
        }
    };

    /**
     * Take a photo with camera
     */
    const takePhoto = async (type: 'source' | 'target') => {
        try {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
                Alert.alert('Permission needed', 'Camera permission is required');
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
                base64: true,
            });

            if (!result.canceled && result.assets[0] && result.assets[0].base64) {
                const imageData: SelectedImage = {
                    uri: result.assets[0].uri,
                    base64: result.assets[0].base64,
                };
                if (type === 'source') {
                    setSourceImage(imageData);
                } else {
                    setTargetImage(imageData);
                }
                setResultImage(null);
                setError(null);
            }
        } catch (err) {
            toast.error('Error', 'Failed to take photo');
        }
    };

    /**
     * Perform face swap
     */
    const performFaceSwap = async () => {
        if (!sourceImage || !targetImage) {
            Alert.alert('Error', 'Please select both source and target images');
            return;
        }

        setIsProcessing(true);
        setError(null);
        setResultImage(null);

        try {
            // Call API with base64 data
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/faceswap/swap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    source_image: toDataUrl(sourceImage.base64),
                    target_image: toDataUrl(targetImage.base64),
                    enhance_face: enhanceFace,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Face swap failed');
            }

            const result: FaceSwapResult = await response.json();

            // Construct full URL
            const resultUrl = result.result_url.startsWith('http')
                ? result.result_url
                : `${whisperAPI.getBaseUrl()}${result.result_url}`;

            setResultImage(resultUrl);
            toast.success('Success', 'Face swap completed!');

        } catch (err) {
            const message = err instanceof Error ? err.message : 'Face swap failed';
            setError(message);
            toast.error('Error', message);
        } finally {
            setIsProcessing(false);
        }
    };

    /**
     * Reset all images
     */
    const reset = () => {
        setSourceImage(null);
        setTargetImage(null);
        setResultImage(null);
        setError(null);
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        🎭 Face Swap
                    </Text>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        Swap a face from one image onto another
                    </Text>
                </View>

                {/* Image Selection */}
                <View style={styles.imagesRow}>
                    {/* Source Face */}
                    <View style={styles.imageColumn}>
                        <Text style={[styles.imageLabel, { color: theme.colors.textMuted }]}>
                            Source Face
                        </Text>
                        <TouchableOpacity
                            style={[styles.imagePicker, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}
                            onPress={() => pickImage('source')}
                        >
                            {sourceImage ? (
                                <Image source={{ uri: sourceImage.uri }} style={styles.selectedImage} />
                            ) : (
                                <View style={styles.placeholderContent}>
                                    <Ionicons name="person-circle" size={48} color={theme.colors.textMuted} />
                                    <Text style={[styles.placeholderText, { color: theme.colors.textMuted }]}>
                                        Tap to select
                                    </Text>
                                </View>
                            )}
                        </TouchableOpacity>
                        <View style={styles.imageButtons}>
                            <TouchableOpacity
                                style={[styles.smallButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={() => pickImage('source')}
                            >
                                <Ionicons name="images" size={16} color={theme.colors.text} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.smallButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={() => takePhoto('source')}
                            >
                                <Ionicons name="camera" size={16} color={theme.colors.text} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Arrow */}
                    <View style={styles.arrowContainer}>
                        <Ionicons name="arrow-forward" size={24} color={theme.colors.primary} />
                    </View>

                    {/* Target Image */}
                    <View style={styles.imageColumn}>
                        <Text style={[styles.imageLabel, { color: theme.colors.textMuted }]}>
                            Target Image
                        </Text>
                        <TouchableOpacity
                            style={[styles.imagePicker, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}
                            onPress={() => pickImage('target')}
                        >
                            {targetImage ? (
                                <Image source={{ uri: targetImage.uri }} style={styles.selectedImage} />
                            ) : (
                                <View style={styles.placeholderContent}>
                                    <Ionicons name="image" size={48} color={theme.colors.textMuted} />
                                    <Text style={[styles.placeholderText, { color: theme.colors.textMuted }]}>
                                        Tap to select
                                    </Text>
                                </View>
                            )}
                        </TouchableOpacity>
                        <View style={styles.imageButtons}>
                            <TouchableOpacity
                                style={[styles.smallButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={() => pickImage('target')}
                            >
                                <Ionicons name="images" size={16} color={theme.colors.text} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.smallButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={() => takePhoto('target')}
                            >
                                <Ionicons name="camera" size={16} color={theme.colors.text} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {/* Options */}
                <View style={[styles.optionsCard, { backgroundColor: theme.colors.surface }]}>
                    <TouchableOpacity
                        style={styles.optionRow}
                        onPress={() => setEnhanceFace(!enhanceFace)}
                    >
                        <View style={styles.optionInfo}>
                            <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
                                ✨ Enhance Face
                            </Text>
                            <Text style={[styles.optionDesc, { color: theme.colors.textMuted }]}>
                                Apply GFPGAN for better quality
                            </Text>
                        </View>
                        <View style={[
                            styles.checkbox,
                            { borderColor: theme.colors.primary },
                            enhanceFace && { backgroundColor: theme.colors.primary }
                        ]}>
                            {enhanceFace && <Ionicons name="checkmark" size={16} color="#fff" />}
                        </View>
                    </TouchableOpacity>
                </View>

                {/* Swap Button */}
                <TouchableOpacity
                    style={[
                        styles.swapButton,
                        { backgroundColor: theme.colors.primary },
                        (!sourceImage || !targetImage || isProcessing) && styles.buttonDisabled
                    ]}
                    onPress={performFaceSwap}
                    disabled={!sourceImage || !targetImage || isProcessing}
                >
                    {isProcessing ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Ionicons name="swap-horizontal" size={20} color="#fff" />
                            <Text style={styles.swapButtonText}>Swap Faces</Text>
                        </>
                    )}
                </TouchableOpacity>

                {/* Error */}
                {error && (
                    <View style={[styles.errorCard, { backgroundColor: theme.colors.error + '20' }]}>
                        <Ionicons name="alert-circle" size={20} color={theme.colors.error} />
                        <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
                    </View>
                )}

                {/* Result */}
                {resultImage && (
                    <View style={styles.resultSection}>
                        <Text style={[styles.resultLabel, { color: theme.colors.text }]}>
                            Result
                        </Text>
                        <Image source={{ uri: resultImage }} style={styles.resultImage} />
                        <View style={styles.resultButtons}>
                            <TouchableOpacity
                                style={[styles.resultButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={reset}
                            >
                                <Ionicons name="refresh" size={18} color={theme.colors.text} />
                                <Text style={[styles.resultButtonText, { color: theme.colors.text }]}>New Swap</Text>
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
    imagesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.lg,
    },
    imageColumn: {
        flex: 1,
        alignItems: 'center',
    },
    imageLabel: {
        fontSize: fontSize.sm,
        marginBottom: spacing.sm,
        fontWeight: '500',
    },
    imagePicker: {
        width: 140,
        height: 140,
        borderRadius: borderRadius.lg,
        borderWidth: 2,
        borderStyle: 'dashed',
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
    },
    selectedImage: {
        width: '100%',
        height: '100%',
    },
    placeholderContent: {
        alignItems: 'center',
        gap: spacing.xs,
    },
    placeholderText: {
        fontSize: fontSize.xs,
    },
    imageButtons: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginTop: spacing.sm,
    },
    smallButton: {
        padding: spacing.sm,
        borderRadius: borderRadius.md,
    },
    arrowContainer: {
        paddingHorizontal: spacing.sm,
    },
    optionsCard: {
        borderRadius: borderRadius.lg,
        padding: spacing.md,
        marginBottom: spacing.lg,
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    optionInfo: {
        flex: 1,
    },
    optionLabel: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    optionDesc: {
        fontSize: fontSize.xs,
        marginTop: 2,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    swapButton: {
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
    swapButtonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
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
    resultLabel: {
        fontSize: fontSize.lg,
        fontWeight: '600',
        marginBottom: spacing.md,
    },
    resultImage: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: borderRadius.lg,
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
