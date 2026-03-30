/**
 * Whisper App - Upgrade Drawer Component
 * Premium feature upgrade prompt
 */

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

interface UpgradeDrawerProps {
    visible: boolean;
    onClose: () => void;
    onUpgrade: () => void;
    feature?: string;
}

export function UpgradeDrawer({ visible, onClose, onUpgrade, feature = 'this feature' }: UpgradeDrawerProps) {
    const { theme } = useTheme();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <TouchableOpacity
                style={styles.overlay}
                activeOpacity={1}
                onPress={onClose}
            >
                <TouchableOpacity
                    activeOpacity={1}
                    style={[styles.drawer, { backgroundColor: theme.colors.surface }]}
                    onPress={(e) => e.stopPropagation()}
                >
                    {/* Handle */}
                    <View style={[styles.handle, { backgroundColor: theme.colors.textMuted + '40' }]} />

                    <ScrollView showsVerticalScrollIndicator={false}>
                        {/* Icon */}
                        <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                            <Ionicons name="star" size={48} color={theme.colors.primary} />
                        </View>

                        {/* Title */}
                        <Text style={[styles.title, { color: theme.colors.text }]}>
                            Upgrade to Pro
                        </Text>

                        {/* Message */}
                        <Text style={[styles.message, { color: theme.colors.textMuted }]}>
                            {feature} is a premium feature. Upgrade to Pro to unlock:
                        </Text>

                        {/* Features List */}
                        <View style={styles.featuresList}>
                            {[
                                'Smart Mode with multiple AI models',
                                'HuggingFace API access',
                                'Image upscaling & face swap',
                                'Premium roleplay characters',
                                'Unlimited tokens',
                                'Priority support',
                            ].map((item, index) => (
                                <View key={index} style={styles.featureItem}>
                                    <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />
                                    <Text style={[styles.featureText, { color: theme.colors.text }]}>
                                        {item}
                                    </Text>
                                </View>
                            ))}
                        </View>

                        {/* Pricing */}
                        <View style={[styles.pricingCard, { backgroundColor: theme.colors.primary + '10', borderColor: theme.colors.primary + '30' }]}>
                            <Text style={[styles.price, { color: theme.colors.primary }]}>
                                ₹99<Text style={styles.period}>/month</Text>
                            </Text>
                            <Text style={[styles.pricingNote, { color: theme.colors.textMuted }]}>
                                Cancel anytime
                            </Text>
                        </View>

                        {/* Upgrade Button */}
                        <TouchableOpacity
                            style={[styles.upgradeButton, { backgroundColor: theme.colors.primary }]}
                            onPress={onUpgrade}
                        >
                            <Ionicons name="star" size={24} color="#000" />
                            <Text style={styles.upgradeButtonText}>Upgrade Now</Text>
                        </TouchableOpacity>

                        {/* Maybe Later */}
                        <TouchableOpacity style={styles.laterButton} onPress={onClose}>
                            <Text style={[styles.laterButtonText, { color: theme.colors.textMuted }]}>
                                Maybe Later
                            </Text>
                        </TouchableOpacity>
                    </ScrollView>
                </TouchableOpacity>
            </TouchableOpacity>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    drawer: {
        borderTopLeftRadius: borderRadius.xl,
        borderTopRightRadius: borderRadius.xl,
        padding: spacing.xl,
        paddingBottom: spacing.xl + spacing.lg,
        maxHeight: '85%',
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: spacing.lg,
    },
    iconContainer: {
        width: 96,
        height: 96,
        borderRadius: 48,
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'center',
        marginBottom: spacing.lg,
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: spacing.md,
    },
    message: {
        fontSize: fontSize.md,
        textAlign: 'center',
        marginBottom: spacing.xl,
        lineHeight: 22,
    },
    featuresList: {
        marginBottom: spacing.xl,
    },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.md,
        gap: spacing.sm,
    },
    featureText: {
        fontSize: fontSize.md,
        flex: 1,
    },
    pricingCard: {
        padding: spacing.lg,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    price: {
        fontSize: 36,
        fontWeight: '700',
    },
    period: {
        fontSize: fontSize.lg,
        fontWeight: '400',
    },
    pricingNote: {
        fontSize: fontSize.sm,
        marginTop: spacing.xs,
    },
    upgradeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        gap: spacing.sm,
        marginBottom: spacing.md,
    },
    upgradeButtonText: {
        color: '#000',
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    laterButton: {
        paddingVertical: spacing.sm,
        alignItems: 'center',
    },
    laterButtonText: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
});
