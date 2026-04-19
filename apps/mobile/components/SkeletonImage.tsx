/**
 * Skeleton Image Component
 * Shows a pulsing placeholder during image generation
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Text, Dimensions } from 'react-native';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

interface SkeletonImageProps {
    width?: number;
    height?: number;
    showProgress?: boolean;
    progress?: number;
    eta?: number;
}

export function SkeletonImage({ 
    width: customWidth, 
    height: customHeight,
    showProgress = false,
    progress = 0,
    eta = 0
}: SkeletonImageProps) {
    const { theme } = useTheme();
    const opacity = useRef(new Animated.Value(0.3)).current;
    
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: 0.7,
                    duration: 1000,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0.3,
                    duration: 1000,
                    useNativeDriver: true,
                }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, []);

    const containerWidth = customWidth || width - spacing.lg * 2;
    const containerHeight = customHeight || containerWidth;

    return (
        <View style={[
            styles.container,
            {
                width: containerWidth,
                height: containerHeight,
                backgroundColor: theme.colors.surfaceLight,
                borderRadius: borderRadius.lg,
            }
        ]}>
            <Animated.View style={[
                styles.shimmer,
                {
                    backgroundColor: theme.colors.surface,
                    opacity,
                }
            ]} />
            
            {/* Icon */}
            <View style={styles.iconContainer}>
                <Ionicons name="image-outline" size={48} color={theme.colors.textMuted} />
            </View>

            {/* Progress */}
            {showProgress && (
                <View style={styles.progressContainer}>
                    <View style={[
                        styles.progressBar,
                        { backgroundColor: theme.colors.surfaceLight }
                    ]}>
                        <View style={[
                            styles.progressFill,
                            {
                                width: `${progress}%`,
                                backgroundColor: theme.colors.primary
                            }
                        ]} />
                    </View>
                    {eta > 0 && (
                        <Text style={[styles.etaText, { color: theme.colors.textSecondary }]}>
                            ~{eta}s remaining
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        position: 'relative',
    },
    shimmer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    iconContainer: {
        position: 'absolute',
    },
    progressContainer: {
        position: 'absolute',
        bottom: spacing.md,
        left: spacing.md,
        right: spacing.md,
    },
    progressBar: {
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
    },
    etaText: {
        fontSize: fontSize.xs,
        marginTop: spacing.xs,
        textAlign: 'center',
    },
});
