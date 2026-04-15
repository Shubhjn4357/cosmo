/**
 * Cosmo AI — Shared Screen Header Component
 * Cosmic glassmorphic header with blur, title, and optional action slot.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, fontSize, borderRadius } from '@/constants/theme';

interface ScreenHeaderProps {
    title: string;
    subtitle?: string;
    onMenuPress?: () => void;
    rightAction?: {
        icon: string;
        onPress: () => void;
        badge?: number;
    };
    showGlow?: boolean;
}

export function ScreenHeader({
    title,
    subtitle,
    onMenuPress,
    rightAction,
    showGlow = false,
}: ScreenHeaderProps) {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const Content = (
        <View
            style={[
                styles.container,
                { paddingTop: insets.top + 8, borderBottomColor: theme.colors.surfaceBorder },
                showGlow && styles.glowContainer,
            ]}
        >
            {/* Left — Menu */}
            {onMenuPress ? (
                <TouchableOpacity
                    style={[styles.iconBtn, { backgroundColor: theme.colors.surfaceLight }]}
                    onPress={onMenuPress}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons name="menu" size={20} color={theme.colors.text} />
                </TouchableOpacity>
            ) : (
                <View style={styles.iconBtnPlaceholder} />
            )}

            {/* Center — Title */}
            <View style={styles.titleBlock}>
                <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                    {title}
                </Text>
                {subtitle ? (
                    <Text style={[styles.subtitle, { color: theme.colors.textMuted }]} numberOfLines={1}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>

            {/* Right — Action */}
            {rightAction ? (
                <TouchableOpacity
                    style={[styles.iconBtn, { backgroundColor: theme.colors.surfaceLight }]}
                    onPress={rightAction.onPress}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons name={rightAction.icon as any} size={20} color={theme.colors.primary} />
                    {rightAction.badge ? (
                        <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
                            <Text style={styles.badgeText}>{rightAction.badge > 9 ? '9+' : rightAction.badge}</Text>
                        </View>
                    ) : null}
                </TouchableOpacity>
            ) : (
                <View style={styles.iconBtnPlaceholder} />
            )}
        </View>
    );

    if (Platform.OS === 'ios') {
        return (
            <BlurView
                intensity={isDark ? 60 : 70}
                tint={isDark ? 'dark' : 'light'}
                style={styles.blurWrapper}
            >
                {Content}
            </BlurView>
        );
    }

    return (
        <View
            style={[
                styles.blurWrapper,
                { backgroundColor: isDark ? 'rgba(5,5,18,0.92)' : 'rgba(245,243,255,0.92)' },
            ]}
        >
            {Content}
        </View>
    );
}

const styles = StyleSheet.create({
    blurWrapper: {
        position: 'absolute',
        top: 0, left: 0, right: 0,
        zIndex: 50,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm + 2,
        borderBottomWidth: 1,
    },
    glowContainer: {
        shadowColor: '#8b5cf6',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
        elevation: 6,
    },
    iconBtn: {
        width: 36,
        height: 36,
        borderRadius: borderRadius.sm + 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconBtnPlaceholder: { width: 36 },
    titleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
    title: { fontSize: fontSize.md, fontWeight: '700', letterSpacing: -0.3 },
    subtitle: { fontSize: fontSize.xs, marginTop: 1 },
    badge: {
        position: 'absolute',
        top: -4, right: -4,
        minWidth: 15, height: 15,
        borderRadius: 8,
        alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 3,
    },
    badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});

export default ScreenHeader;
