/**
 * Whisper App - Support Popup Component
 * Shows a friendly popup for non-pro users with coffee support option
 */

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

interface SupportPopupProps {
    visible: boolean;
    onClose: () => void;
    onUpgrade?: () => void;
}

export function SupportPopup({ visible, onClose, onUpgrade }: SupportPopupProps) {
    const { theme } = useTheme();

    const handleBuyMeCoffee = () => {
        // Replace with your actual Buy Me a Coffee link
        Linking.openURL('https://buymeacoffee.com/yourusername');
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
                    {/* Close button */}
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Ionicons name="close" size={24} color={theme.colors.text} />
                    </TouchableOpacity>

                    {/* Icon */}
                    <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                        <Ionicons name="heart" size={48} color={theme.colors.primary} />
                    </View>

                    {/* Title */}
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        Enjoying Whisper AI?
                    </Text>

                    {/* Message */}
                    <Text style={[styles.message, { color: theme.colors.textMuted }]}>
                        I'm an independent developer building Whisper AI. Your support helps me continue developing and improving the app! ✨
                    </Text>

                    {/* Coffee Button */}
                    <TouchableOpacity
                        style={[styles.coffeeButton, { backgroundColor: theme.colors.primary }]}
                        onPress={handleBuyMeCoffee}
                    >
                        <Ionicons name="cafe" size={24} color="#000" />
                        <Text style={styles.coffeeButtonText}>Buy Me a Coffee ☕</Text>
                    </TouchableOpacity>

                    {/* Upgrade Button (Optional) */}
                    {onUpgrade && (
                        <TouchableOpacity
                            style={[styles.upgradeButton, { borderColor: theme.colors.primary }]}
                            onPress={onUpgrade}
                        >
                            <Ionicons name="star" size={20} color={theme.colors.primary} />
                            <Text style={[styles.upgradeButtonText, { color: theme.colors.primary }]}>
                                Upgrade to Pro
                            </Text>
                        </TouchableOpacity>
                    )}

                    {/* Maybe Later */}
                    <TouchableOpacity style={styles.laterButton} onPress={onClose}>
                        <Text style={[styles.laterButtonText, { color: theme.colors.textMuted }]}>
                            Maybe Later
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
    },
    container: {
        width: '100%',
        maxWidth: 400,
        borderRadius: borderRadius.xl,
        padding: spacing.xl,
        alignItems: 'center',
        position: 'relative',
    },
    closeButton: {
        position: 'absolute',
        top: spacing.md,
        right: spacing.md,
        padding: spacing.xs,
    },
    iconContainer: {
        width: 96,
        height: 96,
        borderRadius: 48,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.lg,
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
        marginBottom: spacing.md,
        textAlign: 'center',
    },
    message: {
        fontSize: fontSize.md,
        lineHeight: 22,
        textAlign: 'center',
        marginBottom: spacing.xl,
    },
    coffeeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        gap: spacing.sm,
        marginBottom: spacing.md,
    },
    coffeeButtonText: {
        color: '#000',
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    upgradeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        paddingVertical: spacing.sm + 2,
        borderRadius: borderRadius.lg,
        borderWidth: 2,
        gap: spacing.xs,
        marginBottom: spacing.md,
    },
    upgradeButtonText: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    laterButton: {
        paddingVertical: spacing.sm,
    },
    laterButtonText: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
});
