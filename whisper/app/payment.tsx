/**
 * Payment/Subscription Screen
 * Razorpay integration for Pro subscriptions and token purchases
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { useAuth } from '@/hooks';
import { whisperAPI, SubscriptionPlan } from '@/services/api';
import { useToast } from '@/components/Toast';
import { GlassCard, GlassButton } from '@/components/Glass';

export default function PaymentScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const { user, profile, refreshProfile } = useAuth();
    const toast = useToast();

    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        loadPlans();
    }, []);

    const loadPlans = async () => {
        try {
            setLoading(true);
            const { plans: fetchedPlans } = await whisperAPI.getPaymentPlans();
            setPlans(fetchedPlans);
        } catch (error) {
            console.error('Failed to load plans:', error);
            toast.error('Error', 'Failed to load subscription plans');
        } finally {
            setLoading(false);
        }
    };

    const handleSubscribe = async (plan: SubscriptionPlan) => {
        if (!user?.id) {
            Alert.alert('Sign In Required', 'Please sign in to subscribe', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign In', onPress: () => router.push('/auth/login') }
            ]);
            return;
        }

        try {
            setProcessing(true);
            toast.info('Processing', 'Opening payment gateway...');

            // Create Razorpay order
            const order = await whisperAPI.createPaymentOrder({
                amount: plan.price,
                planType: plan.id as 'free' | 'pro',
                userId: user.id,
            });

            // TODO: Open Razorpay checkout
            // Note: React Native Razorpay integration would go here
            // For now, show placeholder
            Alert.alert(
                'Payment Gateway',
                `Order created: ${order.order_id}\n\nNote: Razorpay React Native SDK integration required.`,
                [
                    {
                        text: 'OK',
                        onPress: async () => {
                            // Simulate successful payment for demo
                            toast.success('Success', 'Subscription activated!');
                            await refreshProfile();
                            router.back();
                        }
                    }
                ]
            );
        } catch (error: any) {
            console.error('Payment error:', error);
            toast.error('Payment Failed', error.message || 'Please try again');
        } finally {
            setProcessing(false);
        }
    };

    const PlanCard = ({ plan, recommended }: { plan: SubscriptionPlan; recommended?: boolean }) => (
        <GlassCard
            variant={recommended ? "accent" : "medium"}
            style={styles.planCard}
            blurIntensity={25}
        >
            <View style={recommended && { borderWidth: 2, borderColor: theme.colors.primary, borderRadius: borderRadius.lg, padding: -2 }}>
                {recommended && (
                    <View style={[styles.recommendedBadge, { backgroundColor: theme.colors.primary }]}>
                        <Text style={styles.recommendedText}>RECOMMENDED</Text>
                    </View>
                )}

                <Text style={[styles.planName, { color: theme.colors.text }]}>{plan.name}</Text>

                <View style={styles.priceContainer}>
                    <Text style={[styles.currency, { color: theme.colors.textSecondary }]}>₹</Text>
                    <Text style={[styles.price, { color: theme.colors.text }]}>{plan.price}</Text>
                    <Text style={[styles.duration, { color: theme.colors.textSecondary }]}>/{plan.duration}</Text>
                </View>

                <View style={styles.tokensContainer}>
                    <Ionicons name="flash" size={20} color={theme.colors.primary} />
                    <Text style={[styles.tokens, { color: theme.colors.text }]}>
                        {plan.tokens} tokens
                    </Text>
                </View>

                <View style={styles.features}>
                    {plan.features.map((feature, idx) => (
                        <View key={idx} style={styles.featureRow}>
                            <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                            <Text style={[styles.featureText, { color: theme.colors.text }]}>
                                {feature}
                            </Text>
                        </View>
                    ))}
                </View>

                <GlassButton
                    title={processing ? "Processing..." : "Choose Plan"}
                    onPress={() => handleSubscribe(plan)}
                    variant={recommended ? "accent" : "medium"}
                    disabled={processing}
                    style={styles.subscribeButton}
                />
            </View>
        </GlassCard>
    );

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                    <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                        Loading plans...
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                    Upgrade to Pro
                </Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Current Plan Info */}
                {profile && (
                    <View style={[styles.currentPlan, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.currentPlanLabel, { color: theme.colors.textSecondary }]}>
                            Current Plan
                        </Text>
                        <Text style={[styles.currentPlanName, { color: theme.colors.text }]}>
                            {profile.subscription_tier === 'pro' ? 'Pro' : 'Free'}
                        </Text>
                        <View style={styles.tokenInfo}>
                            <Ionicons name="flash" size={16} color={theme.colors.primary} />
                            <Text style={[styles.tokenCount, { color: theme.colors.text }]}>
                                {profile.tokens_limit - profile.tokens_used} tokens remaining
                            </Text>
                        </View>
                    </View>
                )}

                {/* Plans */}
                <View style={styles.plansContainer}>
                    {plans.map((plan, idx) => (
                        <PlanCard
                            key={plan.id}
                            plan={plan}
                            recommended={plan.id === 'pro'}
                        />
                    ))}
                </View>

                {/* Info */}
                <View style={styles.infoContainer}>
                    <Text style={[styles.infoText, { color: theme.colors.textSecondary }]}>
                        • All payments are securely processed via Razorpay
                    </Text>
                    <Text style={[styles.infoText, { color: theme.colors.textSecondary }]}>
                        • Cancel anytime from your profile settings
                    </Text>
                    <Text style={[styles.infoText, { color: theme.colors.textSecondary }]}>
                        • Unused tokens never expire
                    </Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: spacing.md,
    },
    loadingText: {
        fontSize: fontSize.md,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
    },
    backButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.lg,
    },
    currentPlan: {
        padding: spacing.lg,
        borderRadius: borderRadius.lg,
        marginBottom: spacing.xl,
    },
    currentPlanLabel: {
        fontSize: fontSize.sm,
        marginBottom: spacing.xs,
    },
    currentPlanName: {
        fontSize: fontSize.xl,
        fontWeight: '700',
        marginBottom: spacing.sm,
    },
    tokenInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    tokenCount: {
        fontSize: fontSize.md,
    },
    plansContainer: {
        gap: spacing.lg,
        marginBottom: spacing.xl,
    },
    planCard: {
        padding: spacing.lg,
        borderRadius: borderRadius.xl,
        position: 'relative',
    },
    recommendedBadge: {
        position: 'absolute',
        top: -10,
        right: 20,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.full,
    },
    recommendedText: {
        color: '#fff',
        fontSize: fontSize.xs,
        fontWeight: '700',
    },
    planName: {
        fontSize: fontSize.xl,
        fontWeight: '700',
        marginBottom: spacing.md,
    },
    priceContainer: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: spacing.md,
    },
    currency: {
        fontSize: fontSize.lg,
    },
    price: {
        fontSize: 48,
        fontWeight: '700',
    },
    duration: {
        fontSize: fontSize.md,
        marginLeft: spacing.xs,
    },
    tokensContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginBottom: spacing.lg,
    },
    tokens: {
        fontSize: fontSize.lg,
        fontWeight: '600',
    },
    features: {
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    featureText: {
        fontSize: fontSize.md,
        flex: 1,
    },
    subscribeButton: {
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        alignItems: 'center',
    },
    subscribeText: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    infoContainer: {
        gap: spacing.sm,
        marginBottom: spacing.xl,
    },
    infoText: {
        fontSize: fontSize.sm,
    },
});
