/**
 * Cosmo AI — Offline Status Banner
 * Shows when offline, fades in/out smoothly, displays pending sync count.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, fontSize, borderRadius } from '@/constants/theme';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

export function OfflineBanner() {
    const { theme, isDark } = useTheme();
    const { isOfflineMode, isServerReachable, pendingSyncCount, retry } = useNetworkStatus();

    const slideAnim = useRef(new Animated.Value(-60)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    const shouldShow = isOfflineMode || !isServerReachable;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(slideAnim, {
                toValue: shouldShow ? 0 : -60,
                duration: 300,
                useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
                toValue: shouldShow ? 1 : 0,
                duration: 260,
                useNativeDriver: true,
            }),
        ]).start();
    }, [shouldShow]);

    if (!shouldShow) return null;

    const bgColor = isOfflineMode
        ? (isDark ? 'rgba(30,20,60,0.95)' : 'rgba(237,233,254,0.97)')
        : (isDark ? 'rgba(40,15,15,0.95)' : 'rgba(254,226,226,0.97)');

    const textColor = isOfflineMode ? theme.colors.primary : theme.colors.error;
    const iconName = isOfflineMode ? 'cloud-offline-outline' : 'wifi-outline';

    return (
        <Animated.View
            style={[
                styles.banner,
                {
                    backgroundColor: bgColor,
                    borderColor: textColor + '30',
                    transform: [{ translateY: slideAnim }],
                    opacity: opacityAnim,
                },
            ]}
        >
            <View style={styles.left}>
                <Ionicons name={iconName as any} size={14} color={textColor} />
                <Text style={[styles.text, { color: textColor }]}>
                    {isOfflineMode
                        ? `Offline Mode${pendingSyncCount > 0 ? ` · ${pendingSyncCount} changes queued` : ' · All data saved locally'}`
                        : 'Server unreachable · Using local AI'}
                </Text>
            </View>
            <TouchableOpacity onPress={retry} style={[styles.retryBtn, { borderColor: textColor + '40' }]}>
                <Ionicons name="refresh-outline" size={13} color={textColor} />
                <Text style={[styles.retryText, { color: textColor }]}>Retry</Text>
            </TouchableOpacity>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs + 2,
        borderWidth: 1,
        borderTopWidth: 0,
        borderLeftWidth: 0,
        borderRightWidth: 0,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        flex: 1,
    },
    text: {
        fontSize: fontSize.xs,
        fontWeight: '600',
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: borderRadius.sm,
        borderWidth: 1,
    },
    retryText: {
        fontSize: fontSize.xs,
        fontWeight: '700',
    },
});

export default OfflineBanner;
