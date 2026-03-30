/**
 * Analytics Dashboard Screen
 * Display usage statistics, token consumption, and insights
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { whisperAPI } from '@/services/api';
import { useAuth } from '@/hooks';
import { useToast } from '@/components/Toast';

const { width } = Dimensions.get('window');

export default function AnalyticsScreen() {
    const { theme, isDark } = useTheme();
    const router = useRouter();
    const { user } = useAuth();
    const toast = useToast();

    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
    const [usageData, setUsageData] = useState<any>(null);
    const [tokenData, setTokenData] = useState<any>(null);
    const [popularModels, setPopularModels] = useState<any>(null);

    useEffect(() => {
        if (user?.id) {
            loadAnalytics();
        }
    }, [user, period]);

    const loadAnalytics = async () => {
        if (!user?.id) return;

        try {
            setLoading(true);
            const [usage, tokens, models] = await Promise.all([
                whisperAPI.getUsageAnalytics({ userId: user.id, period }),
                whisperAPI.getTokenAnalytics({ userId: user.id, period }),
                whisperAPI.getPopularModels(),
            ]);

            setUsageData(usage);
            setTokenData(tokens);
            setPopularModels(models);
        } catch (error: any) {
            console.error('Failed to load analytics:', error);
            toast.error('Error', 'Failed to load analytics data');
        } finally {
            setLoading(false);
        }
    };

    const StatCard = ({ 
        icon, 
        label, 
        value, 
        color, 
        subtitle 
    }: { 
        icon: string; 
        label: string; 
        value: string | number; 
        color: string;
        subtitle?: string;
    }) => (
        <View style={[styles.statCard, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.statIcon, { backgroundColor: color + '20' }]}>
                <Ionicons name={icon as any} size={24} color={color} />
            </View>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
            {subtitle && (
                <Text style={[styles.statSubtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
            )}
        </View>
    );

    const BarChart = ({ data, color }: { data: { label: string; value: number }[]; color: string }) => {
        const maxValue = Math.max(...data.map(d => d.value), 1);
        
        return (
            <View style={styles.chartContainer}>
                {data.map((item, index) => (
                    <View key={index} style={styles.barWrapper}>
                        <View style={styles.barContainer}>
                            <View
                                style={[
                                    styles.bar,
                                    {
                                        height: `${(item.value / maxValue) * 100}%`,
                                        backgroundColor: color,
                                    },
                                ]}
                            />
                        </View>
                        <Text style={[styles.barLabel, { color: theme.colors.textMuted }]}>
                            {item.label}
                        </Text>
                        <Text style={[styles.barValue, { color: theme.colors.text }]}>
                            {item.value}
                        </Text>
                    </View>
                ))}
            </View>
        );
    };

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                    <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                        Loading analytics...
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
                    Analytics
                </Text>
                <TouchableOpacity onPress={loadAnalytics} style={styles.refreshButton}>
                    <Ionicons name="refresh" size={24} color={theme.colors.primary} />
                </TouchableOpacity>
            </View>

            {/* Period Selector */}
            <View style={styles.periodSelector}>
                {(['day', 'week', 'month'] as const).map((p) => (
                    <TouchableOpacity
                        key={p}
                        style={[
                            styles.periodButton,
                            {
                                backgroundColor: period === p ? theme.colors.primary : theme.colors.surface,
                            },
                        ]}
                        onPress={() => setPeriod(p)}
                    >
                        <Text
                            style={[
                                styles.periodButtonText,
                                { color: period === p ? '#fff' : theme.colors.text },
                            ]}
                        >
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Overview Stats */}
                {usageData && tokenData && (
                    <View style={styles.statsGrid}>
                        <StatCard
                            icon="flash"
                            label="Total Requests"
                            value={usageData.total_requests}
                            color={theme.colors.primary}
                            subtitle={`${usageData.successful_requests} successful`}
                        />
                        <StatCard
                            icon="analytics"
                            label="Tokens Used"
                            value={tokenData.total_tokens_used}
                            color={theme.colors.warning}
                            subtitle={`${tokenData.average_daily_usage}/day avg`}
                        />
                        <StatCard
                            icon="checkmark-circle"
                            label="Success Rate"
                            value={`${Math.round((usageData.successful_requests / usageData.total_requests) * 100)}%`}
                            color={theme.colors.success}
                        />
                        <StatCard
                            icon="time"
                            label="Avg Response"
                            value={`${usageData.average_response_time}ms`}
                            color={theme.colors.accent}
                        />
                    </View>
                )}

                {/* Requests Chart */}
                {usageData?.requests_by_day && (
                    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                            Requests Over Time
                        </Text>
                        <BarChart
                            data={usageData.requests_by_day.map((d: any) => ({
                                label: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
                                value: d.count,
                            }))}
                            color={theme.colors.primary}
                        />
                    </View>
                )}

                {/* Tokens Chart */}
                {tokenData?.tokens_by_day && (
                    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                            Token Usage Over Time
                        </Text>
                        <BarChart
                            data={tokenData.tokens_by_day.map((d: any) => ({
                                label: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
                                value: d.tokens,
                            }))}
                            color={theme.colors.warning}
                        />
                    </View>
                )}

                {/* Feature Usage */}
                {tokenData?.tokens_by_feature && (
                    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                            Tokens by Feature
                        </Text>
                        <View style={styles.featureList}>
                            {tokenData.tokens_by_feature.map((feature: any, index: number) => (
                                <View key={index} style={styles.featureRow}>
                                    <View style={styles.featureInfo}>
                                        <Text style={[styles.featureName, { color: theme.colors.text }]}>
                                            {feature.feature}
                                        </Text>
                                        <View style={styles.progressBar}>
                                            <View
                                                style={[
                                                    styles.progressFill,
                                                    {
                                                        width: `${(feature.tokens / tokenData.total_tokens_used) * 100}%`,
                                                        backgroundColor: theme.colors.primary,
                                                    },
                                                ]}
                                            />
                                        </View>
                                    </View>
                                    <Text style={[styles.featureTokens, { color: theme.colors.textSecondary }]}>
                                        {feature.tokens}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* Popular Models */}
                {popularModels?.models && (
                    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                            Popular AI Models
                        </Text>
                        <View style={styles.modelsList}>
                            {popularModels.models.slice(0, 5).map((model: any, index: number) => (
                                <View key={index} style={styles.modelRow}>
                                    <View style={styles.modelRank}>
                                        <Text style={[styles.rankText, { color: theme.colors.primary }]}>
                                            #{index + 1}
                                        </Text>
                                    </View>
                                    <View style={styles.modelInfo}>
                                        <Text style={[styles.modelName, { color: theme.colors.text }]}>
                                            {model.model}
                                        </Text>
                                        <Text style={[styles.modelUsage, { color: theme.colors.textMuted }]}>
                                            {model.usage_count} uses • {model.percentage}%
                                        </Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                )}
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
    refreshButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    periodSelector: {
        flexDirection: 'row',
        paddingHorizontal: spacing.lg,
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    periodButton: {
        flex: 1,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
        alignItems: 'center',
    },
    periodButtonText: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.lg,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.md,
        marginBottom: spacing.lg,
    },
    statCard: {
        width: (width - spacing.lg * 2 - spacing.md) / 2,
        padding: spacing.md,
        borderRadius: borderRadius.xl,
        gap: spacing.xs,
    },
    statIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.xs,
    },
    statValue: {
        fontSize: 28,
        fontWeight: '700',
    },
    statLabel: {
        fontSize: fontSize.sm,
    },
    statSubtitle: {
        fontSize: fontSize.xs,
    },
    section: {
        padding: spacing.lg,
        borderRadius: borderRadius.xl,
        marginBottom: spacing.lg,
    },
    sectionTitle: {
        fontSize: fontSize.lg,
        fontWeight: '700',
        marginBottom: spacing.lg,
    },
    chartContainer: {
        flexDirection: 'row',
        gap: spacing.sm,
        height: 200,
    },
    barWrapper: {
        flex: 1,
        alignItems: 'center',
        gap: spacing.xs,
    },
    barContainer: {
        flex: 1,
        width: '100%',
        justifyContent: 'flex-end',
    },
    bar: {
        width: '100%',
        borderRadius: borderRadius.sm,
        minHeight: 4,
    },
    barLabel: {
        fontSize: fontSize.xs,
    },
    barValue: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
    featureList: {
        gap: spacing.md,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    featureInfo: {
        flex: 1,
        gap: spacing.xs,
    },
    featureName: {
        fontSize: fontSize.md,
        fontWeight: '500',
        textTransform: 'capitalize',
    },
    progressBar: {
        height: 6,
        backgroundColor: 'rgba(128, 128, 128, 0.2)',
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 3,
    },
    featureTokens: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    modelsList: {
        gap: spacing.md,
    },
    modelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    modelRank: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(128, 128, 128, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    rankText: {
        fontSize: fontSize.sm,
        fontWeight: '700',
    },
    modelInfo: {
        flex: 1,
    },
    modelName: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    modelUsage: {
        fontSize: fontSize.sm,
    },
});
