/**
 * Whisper App - Token Limit Popup
 * Shows when user's tokens are exhausted
 */

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

interface TokenLimitPopupProps {
    visible: boolean;
    onClose: () => void;
    tokensUsed: number;
    tokensLimit: number;
}

export function TokenLimitPopup({ visible, onClose, tokensUsed, tokensLimit }: TokenLimitPopupProps) {
    const { theme, isDark } = useTheme();
    const router = useRouter();
    const scaleAnim = React.useRef(new Animated.Value(0.8)).current;
    const fadeAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    friction: 6,
                    tension: 80,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible]);

    const handleUpgrade = () => {
        onClose();
        router.push('/subscription');
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <Animated.View
                    style={[
                        styles.container,
                        {
                            backgroundColor: isDark ? '#1E2535' : '#FFFFFF',
                            transform: [{ scale: scaleAnim }],
                            opacity: fadeAnim,
                        },
                    ]}
                >
                    {/* Close button */}
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Ionicons name="close" size={24} color={theme.colors.textMuted} />
                    </TouchableOpacity>

                    {/* Icon */}
                    <View style={[styles.iconContainer, { backgroundColor: theme.colors.warning + '20' }]}>
                        <Ionicons name="warning" size={40} color={theme.colors.warning} />
                    </View>

                    {/* Title */}
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        Token Limit Reached
                    </Text>

                    {/* Usage */}
                    <View style={[styles.usageCard, { backgroundColor: theme.colors.error + '10' }]}>
                        <Text style={[styles.usageText, { color: theme.colors.error }]}>
                            {tokensUsed} / {tokensLimit} tokens used
                        </Text>
                    </View>

                    {/* Description */}
                    <Text style={[styles.description, { color: theme.colors.textMuted }]}>
                        You've used all your monthly tokens. 
                        Upgrade to Pro for 1000 tokens/month or buy more tokens!
                    </Text>

                    {/* Pro Benefits */}
                    <View style={styles.benefits}>
                        <View style={styles.benefitRow}>
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                            <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                                1000 tokens/month
                            </Text>
                        </View>
                        <View style={styles.benefitRow}>
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                            <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                                Priority processing
                            </Text>
                        </View>
                        <View style={styles.benefitRow}>
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                            <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                                Only ₹99/month
                            </Text>
                        </View>
                    </View>

                    {/* Upgrade Button */}
                    <TouchableOpacity
                        style={[styles.upgradeButton, { backgroundColor: theme.colors.primary }]}
                        onPress={handleUpgrade}
                    >
                        <Ionicons name="diamond" size={20} color="#fff" />
                        <Text style={styles.upgradeButtonText}>Upgrade to Pro</Text>
                    </TouchableOpacity>

                    {/* Maybe later */}
                    <TouchableOpacity style={styles.laterButton} onPress={onClose}>
                        <Text style={[styles.laterText, { color: theme.colors.textMuted }]}>
                            Maybe later
                        </Text>
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
    },
    container: {
        width: '100%',
        maxWidth: 340,
        borderRadius: borderRadius.xl,
        padding: spacing.xl,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
    },
    closeButton: {
        position: 'absolute',
        top: spacing.md,
        right: spacing.md,
        padding: spacing.xs,
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.md,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        marginBottom: spacing.sm,
        textAlign: 'center',
    },
    usageCard: {
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
        marginBottom: spacing.md,
    },
    usageText: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    description: {
        fontSize: fontSize.md,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: spacing.lg,
    },
    benefits: {
        width: '100%',
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    benefitRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    benefitText: {
        fontSize: fontSize.sm,
    },
    upgradeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
        borderRadius: borderRadius.md,
        width: '100%',
        gap: spacing.sm,
    },
    upgradeButtonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '700',
    },
    laterButton: {
        marginTop: spacing.md,
        padding: spacing.sm,
    },
    laterText: {
        fontSize: fontSize.sm,
    },
});

export default TokenLimitPopup;
