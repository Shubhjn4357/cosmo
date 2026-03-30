/**
 * Face Swap Screen
 * Upload two images and swap faces using AI with glassmorphic design
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Image,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { whisperAPI } from '@/services/api';
import { useUnifiedTokens } from '@/hooks';
import { useToast } from '@/components/Toast';
import { GlassCard, GlassButton } from '@/components/Glass';

export default function FaceSwapScreen() {
    const { theme, isDark } = useTheme();
    const router = useRouter();
    const { getApiParams, checkTokens, getTokenCost } = useUnifiedTokens();
    const toast = useToast();

    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [targetImage, setTargetImage] = useState<string | null>(null);
    const [resultImage, setResultImage] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);

    const pickImage = async (setImage: (uri: string) => void) => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Required', 'Please allow access to your photos');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
            });

            if (!result.canceled && result.assets[0]) {
                setImage(result.assets[0].uri);
            }
        } catch (error) {
            console.error('Image picker error:', error);
            toast.error('Error', 'Failed to pick image');
        }
    };

    const handleFaceSwap = async () => {
        if (!sourceImage || !targetImage) {
            Alert.alert('Missing Images', 'Please select both source and target images');
            return;
        }

        // Check tokens
        const cost = getTokenCost('face_swap');
        const hasTokens = await checkTokens(cost);
        if (!hasTokens) {
            Alert.alert('Insufficient Tokens', `You need ${cost} tokens for face swap`);
            return;
        }

        try {
            setProcessing(true);
            toast.info('Processing', 'Swapping faces...');

            const params = getApiParams();
            const result = await whisperAPI.faceSwap({
                sourceImage,
                targetImage,
                userId: params.user_id,
                sessionId: params.session_id,
            });

            setResultImage(result.result_url);
            toast.success('Success', 'Face swap complete!');
        } catch (error: any) {
            console.error('Face swap error:', error);
            toast.error('Error', error.message || 'Face swap failed');
        } finally {
            setProcessing(false);
        }
    };

    const saveToGallery = async () => {
        if (!resultImage) return;

        try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Required', 'Please allow access to save photos');
                return;
            }

            await MediaLibrary.saveToLibraryAsync(resultImage);
            toast.success('Saved', 'Image saved to gallery');
        } catch (error) {
            console.error('Save error:', error);
            toast.error('Error', 'Failed to save image');
        }
    };

    const reset = () => {
        setSourceImage(null);
        setTargetImage(null);
        setResultImage(null);
    };

    const ImageBox = ({
        label,
        imageUri,
        onPress
    }: {
        label: string;
        imageUri: string | null;
        onPress: () => void;
    }) => (
        <TouchableOpacity onPress={onPress} style={styles.imageBoxWrapper}>
            <GlassCard variant="medium" style={styles.imageBox}>
                {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.image} />
                ) : (
                    <View style={styles.placeholder}>
                        <LinearGradient
                            colors={[
                                isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                                isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                            ]}
                            style={styles.placeholderGradient}
                        >
                            <Ionicons name="image-outline" size={48} color={theme.colors.textMuted} />
                            <Text style={[styles.placeholderText, { color: theme.colors.textMuted }]}>
                                {label}
                            </Text>
                        </LinearGradient>
                    </View>
                )}
            </GlassCard>
        </TouchableOpacity>
    );

    return (
        <LinearGradient
            colors={isDark
                ? ['#0A0A0F', '#1A1A2E', '#16213E']
                : ['#E3F2FD', '#BBDEFB', '#90CAF9']
            }
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                        Face Swap
                    </Text>
                    {resultImage && (
                        <TouchableOpacity onPress={reset} style={styles.resetButton}>
                            <Ionicons name="refresh" size={24} color={theme.colors.primary} />
                        </TouchableOpacity>
                    )}
                    {!resultImage && <View style={{ width: 24 }} />}
                </View>

                <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
                    {/* Instructions */}
                    <GlassCard variant="light" style={styles.infoCard}>
                        <View style={styles.infoContent}>
                            <Ionicons name="information-circle" size={24} color={theme.colors.primary} />
                            <Text style={[styles.infoText, { color: theme.colors.text }]}>
                                Select a source face and a target image. The face from the source will be swapped onto the target.
                            </Text>
                        </View>
                    </GlassCard>

                    {/* Image Selection */}
                    {!resultImage ? (
                        <>
                            <View style={styles.imagesRow}>
                                <View style={styles.imageColumn}>
                                    <Text style={[styles.label, { color: theme.colors.text }]}>Source Face</Text>
                                    <ImageBox
                                        label="Select Face"
                                        imageUri={sourceImage}
                                        onPress={() => pickImage(setSourceImage)}
                                    />
                                </View>

                                <View style={styles.swapIcon}>
                                    <GlassCard variant="accent" style={styles.swapIconCard}>
                                        <Ionicons name="swap-horizontal" size={32} color={theme.colors.primary} />
                                    </GlassCard>
                                </View>

                                <View style={styles.imageColumn}>
                                    <Text style={[styles.label, { color: theme.colors.text }]}>Target Image</Text>
                                    <ImageBox
                                        label="Select Target"
                                        imageUri={targetImage}
                                        onPress={() => pickImage(setTargetImage)}
                                    />
                                </View>
                            </View>

                            {/* Swap Button */}
                            <GlassButton
                                title={processing ? 'Processing...' : 'Swap Faces (3 tokens)'}
                                onPress={handleFaceSwap}
                                variant="accent"
                                disabled={!sourceImage || !targetImage || processing}
                                icon={processing ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <Ionicons name="flash" size={20} color="#fff" />
                                )}
                                style={styles.swapButton}
                            />
                        </>
                    ) : (
                        /* Result */
                        <View style={styles.resultContainer}>
                            <Text style={[styles.resultLabel, { color: theme.colors.text }]}>✨ Result</Text>
                            <GlassCard variant="medium" style={styles.resultImageCard}>
                                <Image source={{ uri: resultImage }} style={styles.resultImage} />
                            </GlassCard>

                            <View style={styles.resultActions}>
                                <GlassButton
                                    title="Save to Gallery"
                                    onPress={saveToGallery}
                                    variant="accent"
                                    icon={<Ionicons name="download" size={20} color="#fff" />}
                                    style={styles.actionButton}
                                />

                                <GlassButton
                                    title="New Swap"
                                    onPress={reset}
                                    variant="medium"
                                    icon={<Ionicons name="refresh" size={20} color={theme.colors.primary} />}
                                    style={styles.actionButton}
                                    textStyle={{ color: theme.colors.primary }}
                                />
                            </View>
                        </View>
                    )}
                </ScrollView>
            </SafeAreaView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    gradient: {
        flex: 1,
    },
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
    },
    backButton: {
        padding: spacing.xs,
    },
    resetButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        padding: spacing.lg,
        gap: spacing.xl,
    },
    infoCard: {
        padding: spacing.md,
    },
    infoContent: {
        flexDirection: 'row',
        gap: spacing.md,
        alignItems: 'center',
    },
    infoText: {
        flex: 1,
        fontSize: fontSize.sm,
        lineHeight: 20,
    },
    imagesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    imageColumn: {
        flex: 1,
        gap: spacing.sm,
    },
    label: {
        fontSize: fontSize.md,
        fontWeight: '600',
        textAlign: 'center',
    },
    imageBoxWrapper: {
        aspectRatio: 1,
    },
    imageBox: {
        flex: 1,
    },
    image: {
        width: '100%',
        height: '100%',
        borderRadius: borderRadius.xl,
    },
    placeholder: {
        flex: 1,
    },
    placeholderGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: spacing.sm,
        borderRadius: borderRadius.xl,
    },
    placeholderText: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    swapIcon: {
        paddingVertical: spacing.xl,
    },
    swapIconCard: {
        padding: spacing.md,
    },
    swapButton: {
        marginTop: spacing.md,
    },
    resultContainer: {
        gap: spacing.lg,
    },
    resultLabel: {
        fontSize: fontSize.xl,
        fontWeight: '700',
        textAlign: 'center',
    },
    resultImageCard: {
        aspectRatio: 1,
        width: '100%',
    },
    resultImage: {
        width: '100%',
        height: '100%',
        borderRadius: borderRadius.xl,
    },
    resultActions: {
        gap: spacing.md,
    },
    actionButton: {
        width: '100%',
    },
});
