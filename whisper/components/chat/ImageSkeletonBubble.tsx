/**
 * Whisper App - Image Skeleton Bubble
 * Animated loading placeholder for image generation
 */

import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

export function ImageSkeletonBubble() {
    const { theme, isDark } = useTheme();
    const shimmerAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.95)).current;

    useEffect(() => {
        // Shimmer animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(shimmerAnim, {
                    toValue: 1,
                    duration: 1500,
                    useNativeDriver: true,
                    easing: Easing.inOut(Easing.ease),
                }),
                Animated.timing(shimmerAnim, {
                    toValue: 0,
                    duration: 1500,
                    useNativeDriver: true,
                    easing: Easing.inOut(Easing.ease),
                }),
            ])
        ).start();

        // Breathing scale animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(scaleAnim, {
                    toValue: 1,
                    duration: 2000,
                    useNativeDriver: true,
                    easing: Easing.inOut(Easing.ease),
                }),
                Animated.timing(scaleAnim, {
                    toValue: 0.95,
                    duration: 2000,
                    useNativeDriver: true,
                    easing: Easing.inOut(Easing.ease),
                }),
            ])
        ).start();
    }, []);

    const shimmerOpacity = shimmerAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.3, 0.6, 0.3],
    });

    return (
        <View style={styles.container}>
            {/* Avatar */}
            <View style={[styles.avatar, { backgroundColor: theme.colors.primary + '30' }]}>
                <Ionicons name="sparkles" size={16} color={theme.colors.primary} />
            </View>

            {/* Image Placeholder */}
            <Animated.View
                style={[
                    styles.imagePlaceholder,
                    {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                        borderColor: theme.colors.surfaceBorder,
                        transform: [{ scale: scaleAnim }],
                    },
                ]}
            >
                {/* Shimmer overlay */}
                <Animated.View
                    style={[
                        styles.shimmer,
                        {
                            backgroundColor: theme.colors.primary,
                            opacity: shimmerOpacity,
                        },
                    ]}
                />

                {/* Icon and text */}
                <View style={styles.content}>
                    <Animated.View style={{ opacity: shimmerOpacity }}>
                        <Ionicons name="image" size={48} color={theme.colors.primary} />
                    </Animated.View>
                    <Text style={[styles.text, { color: theme.colors.textMuted }]}>
                        Creating image...
                    </Text>
                    <View style={styles.dotsContainer}>
                        {[0, 1, 2].map((i) => (
                            <Animated.View
                                key={i}
                                style={[
                                    styles.dot,
                                    {
                                        backgroundColor: theme.colors.primary,
                                        opacity: shimmerAnim.interpolate({
                                            inputRange: [0, 0.33 * i, 0.33 * (i + 1), 1],
                                            outputRange: [0.3, 0.3, 1, 0.3],
                                        }),
                                    },
                                ]}
                            />
                        ))}
                    </View>
                </View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: spacing.md,
        paddingRight: 40,
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.sm,
    },
    imagePlaceholder: {
        flex: 1,
        aspectRatio: 1,
        maxWidth: 280,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    shimmer: {
        ...StyleSheet.absoluteFillObject,
    },
    content: {
        alignItems: 'center',
        gap: spacing.sm,
    },
    text: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    dotsContainer: {
        flexDirection: 'row',
        gap: spacing.xs,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
});

export default ImageSkeletonBubble;
