/**
 * Whisper App - MessageBubble Component
 * Displays a single chat message with animations and actions
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
    Easing,
    Image,
    Dimensions,
    TouchableOpacity,
    Pressable,
    Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { Message } from '@/types';
import { useToast } from '@/components/Toast';
import { useDialog } from '@/components/Dialog';

const { width } = Dimensions.get('window');

interface MessageBubbleProps {
    message: Message;
    isNew?: boolean;
    isStreaming?: boolean;
    streamingText?: string;
    onDelete?: (id: string) => void;
    onRetry?: (message: Message) => void;
    onSpeak?: (text: string) => void;
    onGenerateVision?: (text: string) => Promise<string | null>; // Returns image URL
    isFailed?: boolean;
    isSpeaking?: boolean;
}

export function MessageBubble({
    message,
    isNew = false,
    isStreaming = false,
    streamingText = '',
    onDelete,
    onRetry,
    onSpeak,
    onGenerateVision,
    isFailed = false,
    isSpeaking = false,
}: MessageBubbleProps) {
    const { theme, isDark } = useTheme();
    const toast = useToast();
    const dialog = useDialog();
    const [showActions, setShowActions] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isGeneratingVision, setIsGeneratingVision] = useState(false);
    const [visionImageUrl, setVisionImageUrl] = useState<string | null>(null);

    // Animation values
    const fadeAnim = useRef(new Animated.Value(isNew ? 0 : 1)).current;
    const scaleAnim = useRef(new Animated.Value(isNew ? 0.8 : 1)).current;
    const slideAnim = useRef(new Animated.Value(isNew ? 20 : 0)).current;
    const glowAnim = useRef(new Animated.Value(0)).current;
    const actionsAnim = useRef(new Animated.Value(0)).current;

    // Popup + fade animation on mount
    useEffect(() => {
        if (isNew) {
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                    easing: Easing.out(Easing.back(1.5)),
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    friction: 6,
                    tension: 80,
                    useNativeDriver: true,
                }),
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: 250,
                    useNativeDriver: true,
                    easing: Easing.out(Easing.ease),
                }),
            ]).start();

            // Subtle glow pulse for AI messages
            if (!message.isUser) {
                Animated.loop(
                    Animated.sequence([
                        Animated.timing(glowAnim, {
                            toValue: 1,
                            duration: 1000,
                            useNativeDriver: false,
                        }),
                        Animated.timing(glowAnim, {
                            toValue: 0,
                            duration: 1000,
                            useNativeDriver: false,
                        }),
                    ]),
                    { iterations: 2 }
                ).start();
            }
        }
    }, [isNew]);

    // Toggle actions animation
    useEffect(() => {
        Animated.spring(actionsAnim, {
            toValue: showActions ? 1 : 0,
            friction: 8,
            tension: 100,
            useNativeDriver: true,
        }).start();
    }, [showActions]);

    const handleLongPress = () => {
        setShowActions(true);
    };

    const handleCopy = async () => {
        await Clipboard.setStringAsync(message.text);
        setShowActions(false);
        toast.success('Copied', 'Text copied to clipboard');
    };

    const handleDownloadImage = async () => {
        if (!message.imageUri) return;

        setIsDownloading(true);
        try {
            // Request permission
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') {
                toast.error('Permission Required', 'Please grant media library access to download images');
                return;
            }

            // Create full URL if needed
            let imageUrl = message.imageUri;
            if (imageUrl.startsWith('/')) {
                const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-whisper-ai.hf.space';
                imageUrl = `${apiUrl}${imageUrl}`;
            }

            // Download image to cache
            const fileName = `Whisper_image_${Date.now()}.png`;
            const downloadPath = FileSystem.cacheDirectory + fileName;

            const downloadResult = await FileSystem.downloadAsync(imageUrl, downloadPath);

            if (downloadResult.status === 200) {
                // Save to device gallery
                const asset = await MediaLibrary.createAssetAsync(downloadResult.uri);
                await MediaLibrary.createAlbumAsync('Whisper AI', asset, false);

                toast.success('Downloaded!', 'Image saved to your gallery in "Whisper AI" album');
            } else {
                throw new Error('Download failed');
            }
        } catch (error) {
            console.error('Download error:', error);
            toast.error('Error', 'Failed to download image. Please try again.');
        } finally {
            setIsDownloading(false);
            setShowActions(false);
        }
    };

    const handleDelete = () => {
        dialog.confirm({
            title: 'Delete Message',
            message: 'Are you sure you want to delete this message?',
            icon: 'trash-outline',
            iconColor: '#ef4444',
            confirmText: 'Delete',
            confirmStyle: 'destructive',
            onConfirm: () => {
                onDelete?.(message.id);
                setShowActions(false);
            },
            onCancel: () => setShowActions(false),
        });
    };

    const handleRetry = () => {
        onRetry?.(message);
        setShowActions(false);
    };

    const handleGenerateVision = async () => {
        if (!onGenerateVision || isGeneratingVision) return;

        setIsGeneratingVision(true);
        setShowActions(false);

        try {
            const imageUrl = await onGenerateVision(message.text);
            if (imageUrl) {
                setVisionImageUrl(imageUrl);
                toast.success('Vision Generated!', 'Image created from your message');
            } else {
                toast.error('Failed', 'Could not generate vision');
            }
        } catch (error) {
            console.error('Vision generation error:', error);
            toast.error('Error', 'Failed to generate vision. Try again.');
        } finally {
            setIsGeneratingVision(false);
        }
    };

    const glowOpacity = glowAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.3, 0.7],
    });

    const actionsScale = actionsAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.8, 1],
    });

    return (
        <Pressable
            onLongPress={handleLongPress}
            onPress={() => showActions && setShowActions(false)}
            delayLongPress={400}
        >
            <Animated.View style={[
                styles.container,
                message.isUser ? styles.userContainer : styles.aiContainer,
                {
                    opacity: fadeAnim,
                    transform: [
                        { scale: scaleAnim },
                        { translateY: slideAnim },
                    ],
                }
            ]}>
                {/* AI Avatar with glow */}
                {!message.isUser && (
                    <View style={styles.avatarWrapper}>
                        <Animated.View style={[
                            styles.avatarGlow,
                            {
                                backgroundColor: theme.colors.primary,
                                opacity: glowOpacity,
                            }
                        ]} />
                        <View style={[styles.avatar, { backgroundColor: theme.colors.primary + '20' }]}>
                            <Ionicons name="sparkles" size={14} color={theme.colors.primary} />
                        </View>
                    </View>
                )}

                <View style={{ flexShrink: 1 }}>
                    {/* Content Bubble */}
                    <View style={[
                        styles.bubble,
                        message.isUser ?
                            { backgroundColor: theme.colors.primary, borderBottomRightRadius: 4 } :
                            {
                                backgroundColor: isDark ? 'rgba(30,35,50,0.9)' : 'rgba(255,255,255,0.95)',
                                borderBottomLeftRadius: 4,
                                borderWidth: 1,
                                borderColor: theme.colors.surfaceBorder
                            },
                        isFailed && { borderColor: theme.colors.error, borderWidth: 1 }
                    ]}>
                        {/* File attachment indicator */}
                        {message.file && (
                            <View style={[styles.fileIndicator, { backgroundColor: theme.colors.surfaceLight }]}>
                                <Ionicons name="document-attach" size={12} color={theme.colors.primary} />
                                <Text style={[styles.fileName, { color: theme.colors.text }]} numberOfLines={1}>
                                    {message.file.name}
                                </Text>
                            </View>
                        )}

                        {message.imageUri ? (
                            <View>
                                <Image
                                    source={{
                                        uri: message.imageUri.startsWith('/')
                                            ? `${process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-whisper-ai.hf.space'}${message.imageUri}`
                                            : message.imageUri
                                    }}
                                    style={styles.image}
                                    resizeMode="cover"
                                />
                                {message.text && (
                                    <Text style={[
                                        styles.text,
                                        message.isUser ? { color: '#fff' } : { color: theme.colors.text }
                                    ]}>{message.text}</Text>
                                )}
                            </View>
                        ) : (
                            <Text style={[
                                styles.text,
                                message.isUser ? { color: '#fff' } : { color: theme.colors.text }
                                ]}>
                                    {streamingText || message.text}
                                    {isStreaming && !message.isUser && <Text style={{ opacity: 0.5 }}>▊</Text>}
                                </Text>
                        )}

                        {/* Failed indicator */}
                        {isFailed && (
                            <View style={styles.failedIndicator}>
                                <Ionicons name="alert-circle" size={14} color={theme.colors.error} />
                                <Text style={[styles.failedText, { color: theme.colors.error }]}>
                                    Failed to send
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Generated Vision Image (inline) */}
                    {visionImageUrl && (
                        <View style={{ marginTop: spacing.xs }}>
                            <Image
                                source={{ uri: visionImageUrl }}
                                style={[styles.image, { borderRadius: borderRadius.md }]}
                                resizeMode="cover"
                            />
                            <Text style={[styles.visionLabel, { color: theme.colors.textMuted }]}>
                                Generated Vision ✨
                            </Text>
                        </View>
                    )}

                    {/* Action buttons */}
                    {showActions && (
                        <Animated.View style={[
                            styles.actionsRow,
                            {
                                opacity: actionsAnim,
                                transform: [{ scale: actionsScale }],
                            },
                            message.isUser ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }
                        ]}>
                            {/* Copy button */}
                            <TouchableOpacity
                                style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}
                                onPress={handleCopy}
                            >
                                <Ionicons name="copy-outline" size={16} color={theme.colors.textMuted} />
                                <Text style={[styles.actionLabel, { color: theme.colors.textMuted }]}>Copy</Text>
                            </TouchableOpacity>

                            {/* Download button (for images) */}
                            {message.imageUri && (
                                <TouchableOpacity
                                    style={[styles.actionBtn, { backgroundColor: theme.colors.success + '20' }]}
                                    onPress={handleDownloadImage}
                                    disabled={isDownloading}
                                >
                                    <Ionicons
                                        name={isDownloading ? "hourglass-outline" : "download-outline"}
                                        size={16}
                                        color={theme.colors.success || '#10B981'}
                                    />
                                    <Text style={[styles.actionLabel, { color: theme.colors.success || '#10B981' }]}>
                                        {isDownloading ? 'Saving...' : 'Download'}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            {/* TTS Button (AI messages only) */}
                            {!message.isUser && onSpeak && (
                                <TouchableOpacity
                                    style={[styles.actionBtn, { backgroundColor: theme.colors.primary + '20' }]}
                                    onPress={() => {
                                        onSpeak(message.text);
                                        setShowActions(false);
                                    }}
                                >
                                    <Ionicons
                                        name={isSpeaking ? 'stop-circle' : 'volume-high'}
                                        size={16}
                                        color={theme.colors.primary}
                                    />
                                    <Text style={[styles.actionLabel, { color: theme.colors.primary }]}>
                                        {isSpeaking ? 'Stop' : 'Speak'}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            {/* Generate Vision Button (User messages only) */}
                            {message.isUser && onGenerateVision && !message.imageUri && (
                                <TouchableOpacity
                                    style={[styles.actionBtn, { backgroundColor: theme.colors.primary + '20' }]}
                                    onPress={handleGenerateVision}
                                    disabled={isGeneratingVision}
                                >
                                    <Ionicons
                                        name={isGeneratingVision ? "hourglass-outline" : "image-outline"}
                                        size={16}
                                        color={theme.colors.primary}
                                    />
                                    <Text style={[styles.actionLabel, { color: theme.colors.primary }]}>
                                        {isGeneratingVision ? 'Generating...' : 'Generate Vision'}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            {isFailed && onRetry && (
                                <TouchableOpacity
                                    style={[styles.actionBtn, { backgroundColor: theme.colors.warning + '20' }]}
                                    onPress={handleRetry}
                                >
                                    <Ionicons name="refresh" size={16} color={theme.colors.warning} />
                                    <Text style={[styles.actionLabel, { color: theme.colors.warning }]}>Retry</Text>
                                </TouchableOpacity>
                            )}

                            {onDelete && (
                                <TouchableOpacity
                                    style={[styles.actionBtn, { backgroundColor: theme.colors.error + '20' }]}
                                    onPress={handleDelete}
                                >
                                    <Ionicons name="trash-outline" size={16} color={theme.colors.error} />
                                    <Text style={[styles.actionLabel, { color: theme.colors.error }]}>Delete</Text>
                                </TouchableOpacity>
                            )}
                        </Animated.View>
                    )}
                </View>
            </Animated.View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        marginVertical: spacing.xs,
        flexDirection: 'row',
        maxWidth: '90%',
    },
    userContainer: {
        alignSelf: 'flex-end',
        marginLeft: 40,
    },
    aiContainer: {
        alignSelf: 'flex-start',
        marginRight: 40,
    },
    avatarWrapper: {
        marginRight: spacing.xs,
        alignItems: 'center',
    },
    avatarGlow: {
        position: 'absolute',
        width: 36,
        height: 36,
        borderRadius: 18,
    },
    avatar: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bubble: {
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        maxWidth: width - 100,
    },
    fileIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
        marginBottom: spacing.xs,
        gap: spacing.xs,
    },
    fileName: {
        fontSize: fontSize.xs,
        flex: 1,
    },
    image: {
        width: 240,
        height: 240,
        borderRadius: borderRadius.md,
        marginBottom: spacing.xs,
    },
    text: {
        fontSize: fontSize.md,
        lineHeight: 22,
    },
    failedIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.xs,
        gap: spacing.xs,
    },
    failedText: {
        fontSize: fontSize.xs,
    },
    actionsRow: {
        flexDirection: 'row',
        marginTop: spacing.xs,
        gap: spacing.xs,
        flexWrap: 'wrap',
    },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
        gap: 4,
    },
    actionLabel: {
        fontSize: fontSize.xs,
        fontWeight: '500',
    },
    visionLabel: {
        fontSize: 10,
        marginTop: spacing.xs,
        fontStyle: 'italic',
        textAlign: 'center',
    },
});

export default MessageBubble;
