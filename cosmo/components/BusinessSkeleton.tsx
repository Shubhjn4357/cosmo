import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { useTheme, spacing, borderRadius } from '@/constants/theme';
import { BlurView } from 'expo-blur';

const { width } = Dimensions.get('window');

/**
 * BusinessSkeleton component to provide a pulsing loading state for the Business tab.
 * Follows the glassmorphic design system of Cosmo AI.
 */
export function BusinessSkeleton() {
    const { theme, isDark } = useTheme();
    const opacity = useRef(new Animated.Value(0.3)).current;

    useEffect(() => {
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: 0.6,
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
        pulse.start();
        return () => pulse.stop();
    }, []);

    const renderPulse = (style: any) => (
        <Animated.View style={[style, { opacity, backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]} />
    );

    return (
        <View style={styles.container}>
            {/* New Mission Card Skeleton */}
            <View style={[styles.card, { borderColor: theme.colors.surfaceBorder }]}>
                <BlurView intensity={20} style={styles.glass}>
                    {renderPulse(styles.titlePulse)}
                    {renderPulse(styles.inputPulse)}
                    {renderPulse(styles.inputSmallPulse)}
                    <View style={[styles.buttonPulse, { backgroundColor: theme.colors.surfaceLight }]} />
                </BlurView>
            </View>

            {/* List Section Skeleton */}
            <View style={styles.listSection}>
                {renderPulse(styles.sectionTitlePulse)}
                {[1, 2, 3].map((i) => (
                    <View key={i} style={styles.itemSkeleton}>
                        <BlurView intensity={10} style={styles.itemGlass}>
                            <View style={styles.itemHeader}>
                                {renderPulse(styles.itemTitlePulse)}
                                {renderPulse(styles.pillPulse)}
                            </View>
                            {renderPulse(styles.metaPulse)}
                        </BlurView>
                    </View>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { padding: 20 },
    card: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, marginBottom: 30 },
    glass: { padding: 20 },
    titlePulse: { height: 20, width: 100, borderRadius: 4, marginBottom: 15 },
    inputPulse: { height: 100, width: '100%', borderRadius: 12, marginBottom: 12 },
    inputSmallPulse: { height: 45, width: '100%', borderRadius: 12, marginBottom: 20 },
    buttonPulse: { height: 50, width: '100%', borderRadius: 25 },
    listSection: { marginTop: 10 },
    sectionTitlePulse: { height: 24, width: 140, borderRadius: 4, marginBottom: 15 },
    itemSkeleton: { marginBottom: 12, borderRadius: 16, overflow: 'hidden' },
    itemGlass: { padding: 16 },
    itemHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    itemTitlePulse: { height: 18, width: '60%', borderRadius: 4 },
    pillPulse: { height: 18, width: 60, borderRadius: 10 },
    metaPulse: { height: 14, width: '40%', borderRadius: 4 },
});
