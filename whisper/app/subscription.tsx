/**
 * Whisper App - Subscription Screen
 * Token breakdown, Pro upgrade, and token purchase options
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Alert,
    Linking,
    Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { GlassCard, GlassButton } from '@/components/Glass';

// Token costs per action
const TOKEN_COSTS = {
    text_message: 1,
    image_generation: 10,
    file_analysis: 5,
    voice_transcription: 3,
};

// Token packages for purchase
const TOKEN_PACKAGES = [
    { id: 'tokens_100', tokens: 100, price: 49, popular: false },
    { id: 'tokens_500', tokens: 500, price: 149, popular: true },
    { id: 'tokens_1000', tokens: 1000, price: 299, popular: false },
];

export default function SubscriptionScreen() {
    const { theme, isDark } = useTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { profile, refreshProfile, isAuthenticated } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [showPlanDetails, setShowPlanDetails] = useState(false);
    const [purchasingPackage, setPurchasingPackage] = useState<string | null>(null);

    const isPro = profile?.subscription_tier === 'pro';
    const tokensUsed = profile?.tokens_used || 0;
    const tokensLimit = profile?.tokens_limit || 100;
    const tokensRemaining = Math.max(0, tokensLimit - tokensUsed);
    const tokenPercentage = (tokensRemaining / tokensLimit) * 100;

    const handleUpgradeToPro = async () => {
        if (!isAuthenticated || !profile) {
            router.push('/auth/login');
            return;
        }

        setIsLoading(true);
        try {
            const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-whisper-ai.hf.space';
            const response = await fetch(`${apiUrl}/payments/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_id: 'pro_monthly',
                    user_id: profile.id,
                }),
            });
            const data = await response.json();

            if (data.success && data.payment_url) {
                // Open Razorpay payment page
                await Linking.openURL(data.payment_url);
            } else if (data.success) {
            // If no direct URL, show order info
                Alert.alert(
                    'Order Created',
                    `Order ID: ${data.order_id}\nAmount: ₹99/month\n\nPlease complete payment in Razorpay.`,
                    [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Open Razorpay', onPress: () => Linking.openURL('https://razorpay.com') }
                    ]
                );
            } else {
                Alert.alert('Error', data.message || 'Failed to create order');
            }
        } catch (error) {
            console.error('Upgrade error:', error);
            Alert.alert('Error', 'Failed to process upgrade. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleBuyTokens = async (packageId: string) => {
        if (!isAuthenticated || !profile) {
            router.push('/auth/login');
            return;
        }

        setPurchasingPackage(packageId);
        try {
            const pkg = TOKEN_PACKAGES.find(p => p.id === packageId);
            const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-whisper-ai.hf.space';

            const response = await fetch(`${apiUrl}/payments/buy-tokens`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    package_id: packageId,
                    user_id: profile.id,
                    tokens: pkg?.tokens,
                    amount: (pkg?.price || 0) * 100, // Convert to paise
                }),
            });
            const data = await response.json();

            if (data.success && data.payment_url) {
                await Linking.openURL(data.payment_url);
            } else if (data.success) {
                Alert.alert(
                    'Order Created',
                    `Order ID: ${data.order_id}\nTokens: ${pkg?.tokens}\nAmount: ₹${pkg?.price}`,
                    [{ text: 'OK' }]
                );
            } else {
                Alert.alert('Error', data.message || 'Failed to create order');
            }
        } catch (error) {
            console.error('Buy tokens error:', error);
            Alert.alert('Error', 'Failed to process purchase. Please try again.');
        } finally {
            setPurchasingPackage(null);
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Subscription</Text>
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView
                    style={styles.content}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
                >
                    {/* Current Plan Card - Tappable */}
                    <TouchableOpacity
                        onPress={() => setShowPlanDetails(true)}
                        activeOpacity={0.7}
                    >
                        <GlassCard variant="medium" style={styles.planCard} blurIntensity={20}>
                        <View style={styles.planHeader}>
                            <View>
                                <Text style={[styles.planLabel, { color: theme.colors.textMuted }]}>CURRENT PLAN</Text>
                                <Text style={[styles.planName, { color: theme.colors.text }]}>
                                    {isPro ? '✨ Pro' : '🆓 Free'}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={24} color={theme.colors.textMuted} />
                        </View>

                        {/* Token Progress */}
                        <View style={styles.tokenSection}>
                            <View style={styles.tokenRow}>
                                <Text style={[styles.tokenLabel, { color: theme.colors.text }]}>
                                    {isPro ? 'Unlimited Tokens' : 'Daily Tokens'}
                                </Text>
                                <Text style={[styles.tokenCount, { color: theme.colors.primary }]}>
                                    {isPro ? '∞' : `${tokensRemaining} / ${tokensLimit}`}
                                </Text>
                            </View>
                            {!isPro && (
                                <View style={[styles.progressBar, { backgroundColor: theme.colors.surfaceLight }]}>
                                    <View
                                        style={[
                                            styles.progressFill,
                                            {
                                                width: `${tokenPercentage}%`,
                                                backgroundColor: tokensRemaining < 20 ? theme.colors.error : theme.colors.primary,
                                            }
                                        ]}
                                    />
                                </View>
                            )}
                            <Text style={[styles.tapHint, { color: theme.colors.textMuted }]}>
                                Tap for token usage details
                            </Text>
                        </View>
                        </GlassCard>
                    </TouchableOpacity>

                    {/* Upgrade to Pro */}
                    {!isPro && (
                        <>
                            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                                Upgrade to Pro
                            </Text>
                            <LinearGradient
                                colors={[theme.colors.primary, theme.colors.accent || '#8B5CF6']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={styles.proCard}
                            >
                                <View style={styles.proHeader}>
                                    <Text style={styles.proTitle}>✨ Pro Plan</Text>
                                    <View style={styles.priceRow}>
                                        <Text style={styles.price}>₹99</Text>
                                        <Text style={styles.pricePeriod}>/month</Text>
                                    </View>
                                </View>

                                <View style={styles.proFeatures}>
                                    {[
                                        'Unlimited tokens daily',
                                        'Priority AI processing',
                                        'Advanced image generation',
                                        'No daily limits',
                                        'Early access to features',
                                    ].map((feature, idx) => (
                                        <View key={idx} style={styles.featureRow}>
                                            <Ionicons name="checkmark-circle" size={18} color="#fff" />
                                            <Text style={styles.featureText}>{feature}</Text>
                                        </View>
                                    ))}
                                </View>

                                <GlassButton
                                    title={isLoading ? "Processing..." : "Upgrade Now"}
                                    onPress={handleUpgradeToPro}
                                    variant="light"
                                    disabled={isLoading}
                                    icon={!isLoading && <Ionicons name="arrow-forward" size={18} color={theme.colors.primary} />}
                                    style={styles.upgradeButton}
                                    textStyle={{ ...styles.upgradeText, color: theme.colors.primary }}
                                />
                            </LinearGradient>
                        </>
                    )}

                    {/* Buy Tokens */}
                    <Text style={[styles.sectionTitle, { color: theme.colors.text, marginTop: spacing.lg }]}>
                        Buy More Tokens
                    </Text>
                    <View style={styles.packagesGrid}>
                        {TOKEN_PACKAGES.map((pkg) => (
                            <TouchableOpacity
                                key={pkg.id}
                                onPress={() => handleBuyTokens(pkg.id)}
                                disabled={purchasingPackage === pkg.id}
                                style={{ flex: 1 }}
                            >
                                <GlassCard
                                    variant={pkg.popular ? "accent" : "medium"}
                                    style={{
                                        ...styles.packageCard,
                                        ...(pkg.popular && { borderWidth: 2, borderColor: theme.colors.primary })
                                    }}
                                    blurIntensity={pkg.popular ? 30 : 20}
                                >
                                {pkg.popular && (
                                    <View style={[styles.popularBadge, { backgroundColor: theme.colors.primary }]}>
                                        <Text style={styles.popularText}>BEST VALUE</Text>
                                    </View>
                                )}
                                <Text style={[styles.packageTokens, { color: theme.colors.text }]}>
                                    {pkg.tokens}
                                </Text>
                                <Text style={[styles.packageLabel, { color: theme.colors.textMuted }]}>
                                    tokens
                                </Text>
                                <Text style={[styles.packagePrice, { color: theme.colors.primary }]}>
                                    ₹{pkg.price}
                                </Text>
                                {purchasingPackage === pkg.id && (
                                    <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 8 }} />
                                )}
                                </GlassCard>
                            </TouchableOpacity>
                        ))}
                    </View>
                </ScrollView>
            </SafeAreaView>

            {/* Plan Details Modal */}
            <Modal
                visible={showPlanDetails}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setShowPlanDetails(false)}
            >
                <SafeAreaView style={[styles.modalContainer, { backgroundColor: theme.colors.background }]} edges={['top', 'bottom']}>
                    <View style={styles.modalHeader}>
                        <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Token Usage</Text>
                        <TouchableOpacity onPress={() => setShowPlanDetails(false)}>
                            <Ionicons name="close" size={28} color={theme.colors.text} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalContent}>
                        <Text style={[styles.modalSubtitle, { color: theme.colors.textMuted }]}>
                            How many tokens each action uses:
                        </Text>

                        {[
                            { icon: 'chatbubble', label: 'Text Message', cost: TOKEN_COSTS.text_message, desc: 'Regular chat messages' },
                            { icon: 'image', label: 'Image Generation', cost: TOKEN_COSTS.image_generation, desc: 'AI-generated images' },
                            { icon: 'document', label: 'File Analysis', cost: TOKEN_COSTS.file_analysis, desc: 'Document analysis' },
                            { icon: 'mic', label: 'Voice Transcription', cost: TOKEN_COSTS.voice_transcription, desc: 'Speech to text' },
                        ].map((item, idx) => (
                            <View key={idx} style={[styles.usageCard, { backgroundColor: theme.colors.surface }]}>
                                <View style={[styles.usageIcon, { backgroundColor: theme.colors.primary + '20' }]}>
                                    <Ionicons name={item.icon as any} size={24} color={theme.colors.primary} />
                                </View>
                                <View style={styles.usageInfo}>
                                    <Text style={[styles.usageLabel, { color: theme.colors.text }]}>{item.label}</Text>
                                    <Text style={[styles.usageDesc, { color: theme.colors.textMuted }]}>{item.desc}</Text>
                                </View>
                                <View style={styles.usageCost}>
                                    <Text style={[styles.costNumber, { color: theme.colors.primary }]}>{item.cost}</Text>
                                    <Text style={[styles.costLabel, { color: theme.colors.textMuted }]}>tokens</Text>
                                </View>
                            </View>
                        ))}

                        <View style={[styles.tipCard, { backgroundColor: theme.colors.surfaceLight }]}>
                            <Ionicons name="bulb" size={24} color={theme.colors.warning} />
                            <Text style={[styles.tipText, { color: theme.colors.text }]}>
                                Pro users get unlimited tokens! Upgrade to remove all limits.
                            </Text>
                        </View>
                    </ScrollView>
                </SafeAreaView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
    },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.xl, fontWeight: '600' },
    content: { flex: 1, paddingHorizontal: spacing.lg },
    planCard: {
        borderWidth: 1,
        borderRadius: borderRadius.lg,
        padding: spacing.lg,
        marginBottom: spacing.lg,
    },
    planHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    planLabel: { fontSize: fontSize.xs, fontWeight: '600', letterSpacing: 1 },
    planName: { fontSize: fontSize.xxl, fontWeight: '700', marginTop: 4 },
    tokenSection: { gap: 8 },
    tokenRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    tokenLabel: { fontSize: fontSize.md, fontWeight: '500' },
    tokenCount: { fontSize: fontSize.md, fontWeight: '700' },
    progressBar: { height: 8, borderRadius: 4, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 4 },
    tapHint: { fontSize: fontSize.xs, textAlign: 'center', marginTop: 4 },
    sectionTitle: { fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
    proCard: { borderRadius: borderRadius.lg, padding: spacing.lg, marginBottom: spacing.lg },
    proHeader: { marginBottom: spacing.lg },
    proTitle: { fontSize: fontSize.xxl, fontWeight: '700', color: '#fff' },
    priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
    price: { fontSize: 40, fontWeight: '700', color: '#fff' },
    pricePeriod: { fontSize: fontSize.md, color: 'rgba(255,255,255,0.8)', marginBottom: 8 },
    proFeatures: { gap: spacing.sm, marginBottom: spacing.lg },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    featureText: { fontSize: fontSize.md, color: '#fff' },
    upgradeButton: {
        backgroundColor: '#fff',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
        gap: spacing.xs,
    },
    upgradeText: { fontSize: fontSize.md, fontWeight: '700' },
    packagesGrid: { flexDirection: 'row', gap: spacing.md },
    packageCard: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.lg,
        borderRadius: borderRadius.lg,
        position: 'relative',
    },
    popularBadge: {
        position: 'absolute',
        top: -10,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: borderRadius.sm,
    },
    popularText: { fontSize: 8, fontWeight: '700', color: '#fff' },
    packageTokens: { fontSize: 28, fontWeight: '700' },
    packageLabel: { fontSize: fontSize.sm },
    packagePrice: { fontSize: fontSize.lg, fontWeight: '700', marginTop: spacing.sm },
    modalContainer: { flex: 1 },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.1)',
    },
    modalTitle: { fontSize: fontSize.xl, fontWeight: '700' },
    modalContent: { padding: spacing.lg },
    modalSubtitle: { fontSize: fontSize.md, marginBottom: spacing.lg },
    usageCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.md,
        gap: spacing.md,
    },
    usageIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    usageInfo: { flex: 1 },
    usageLabel: { fontSize: fontSize.md, fontWeight: '600' },
    usageDesc: { fontSize: fontSize.sm },
    usageCost: { alignItems: 'center' },
    costNumber: { fontSize: fontSize.xl, fontWeight: '700' },
    costLabel: { fontSize: fontSize.xs },
    tipCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginTop: spacing.md,
        gap: spacing.md,
    },
    tipText: { flex: 1, fontSize: fontSize.sm },
});
