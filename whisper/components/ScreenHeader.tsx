/**
 * Whisper App - Screen Header Component
 * Reusable header with hamburger menu for sidebar navigation
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, fontSize } from '@/constants/theme';

interface ScreenHeaderProps {
    title: string;
    subtitle?: string;
    onMenuPress: () => void;
    rightElement?: React.ReactNode;
    showMenu?: boolean;
}

export function ScreenHeader({
    title,
    subtitle,
    onMenuPress,
    rightElement,
    showMenu = true,
}: ScreenHeaderProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.header, { backgroundColor: theme.colors.background }]}>
            <View style={styles.headerContent}>
                <View style={styles.headerLeft}>
                    {showMenu && (
                        <TouchableOpacity
                            onPress={onMenuPress}
                            style={styles.menuButton}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <Ionicons name="menu" size={26} color={theme.colors.text} />
                        </TouchableOpacity>
                    )}
                    <View style={styles.titleContainer}>
                        <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
                        {subtitle && (
                            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
                                {subtitle}
                            </Text>
                        )}
                    </View>
                </View>

                {rightElement && (
                    <View style={styles.headerRight}>{rightElement}</View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    menuButton: {
        padding: spacing.xs,
    },
    titleContainer: {
        gap: 2,
    },
    title: {
        fontSize: fontSize.xl,
        fontWeight: '700',
    },
    subtitle: {
        fontSize: fontSize.sm,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
});

export default ScreenHeader;
