/**
 * Whisper App - ConnectionBadge Component
 * Shows online/offline status with retry button
 */

import React from 'react';
import { 
    View, 
    Text, 
    TouchableOpacity, 
    StyleSheet, 
    Animated,
    ActivityIndicator 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

interface ConnectionBadgeProps {
    isConnected: boolean;
    isServerReachable: boolean;
    isChecking: boolean;
    onRetry: () => void;
}

export function ConnectionBadge({
    isConnected,
    isServerReachable,
    isChecking,
    onRetry,
}: ConnectionBadgeProps) {
    const { theme, isDark } = useTheme();

    // Determine status
    const isOnline = isConnected && isServerReachable;
    const statusColor = isOnline ? theme.colors.success : theme.colors.error;
    const statusText = isChecking 
        ? 'Connecting...' 
        : isOnline 
            ? 'Online' 
            : !isConnected 
                ? 'No Internet' 
                : 'Server Offline';

    return (
        <View style={[
            styles.container,
            {
                backgroundColor: isDark 
                    ? (isOnline ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)')
                    : (isOnline ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
                borderColor: statusColor + '40',
            }
        ]}>
            {/* Status Dot / Spinner */}
            {isChecking ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            )}

            {/* Status Text */}
            <Text style={[styles.statusText, { color: statusColor }]}>
                {statusText}
            </Text>

            {/* Retry Button (only when offline) */}
            {!isOnline && !isChecking && (
                <TouchableOpacity
                    onPress={onRetry}
                    style={[styles.retryButton, { backgroundColor: statusColor + '20' }]}
                    activeOpacity={0.7}
                >
                    <Ionicons name="refresh" size={14} color={statusColor} />
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
    },
    retryButton: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 2,
    },
});

export default ConnectionBadge;
