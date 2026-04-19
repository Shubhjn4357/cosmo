/**
 * Cosmo App - Connection Status Indicator
 * Shows online/offline status with retry option
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

interface ConnectionStatusProps {
    onRetry?: () => void;
    showLabel?: boolean;
}

export default function ConnectionStatus({ onRetry, showLabel = false }: ConnectionStatusProps) {
    const { theme } = useTheme();
    const [isConnected, setIsConnected] = useState(true);
    const [isChecking, setIsChecking] = useState(false);
    const pulseAnim = useState(new Animated.Value(1))[0];

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state) => {
            setIsConnected(state.isConnected ?? true);
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!isConnected) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 0.5,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [isConnected]);

    const handleRetry = async () => {
        setIsChecking(true);
        try {
            const state = await NetInfo.fetch();
            setIsConnected(state.isConnected ?? true);
            if (onRetry && state.isConnected) {
                onRetry();
            }
        } finally {
            setIsChecking(false);
        }
    };

    // Compact badge version
    if (!showLabel) {
        return (
            <Animated.View
                style={[
                    styles.badge,
                    {
                        backgroundColor: isConnected ? theme.colors.online : theme.colors.offline,
                        opacity: isConnected ? 1 : pulseAnim,
                    },
                ]}
            />
        );
    }

    // Full status bar version
    if (isConnected) {
        return (
            <View style={[styles.statusBar, { backgroundColor: theme.colors.online + '20' }]}>
                <View style={[styles.dot, { backgroundColor: theme.colors.online }]} />
                <Text style={[styles.statusText, { color: theme.colors.online }]}>Connected</Text>
            </View>
        );
    }

    return (
        <View style={[styles.statusBar, { backgroundColor: theme.colors.offline + '20' }]}>
            <Animated.View style={[styles.dot, { backgroundColor: theme.colors.offline, opacity: pulseAnim }]} />
            <Text style={[styles.statusText, { color: theme.colors.offline }]}>Offline</Text>
            <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: theme.colors.offline }]}
                onPress={handleRetry}
                disabled={isChecking}
            >
                <Ionicons
                    name={isChecking ? 'sync' : 'refresh'}
                    size={14}
                    color="#fff"
                />
                <Text style={styles.retryText}>
                    {isChecking ? 'Checking...' : 'Retry'}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    badge: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: borderRadius.md,
        gap: spacing.sm,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: fontSize.xs,
        fontWeight: '600',
        flex: 1,
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingHorizontal: spacing.sm,
        borderRadius: borderRadius.sm,
        gap: 4,
    },
    retryText: {
        color: '#fff',
        fontSize: fontSize.xs,
        fontWeight: '600',
    },
});
