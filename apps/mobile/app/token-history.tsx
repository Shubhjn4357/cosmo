/**
 * Token Usage History Screen
 * Shows detailed token usage over time
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useTokens } from '@/hooks';

const { width } = Dimensions.get('window');

import { api } from '@/services/api';

export default function TokenHistoryScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const { profile } = useAuth();
    const { tokenInfo } = useTokens();
    
    const [usageHistory, setUsageHistory] = useState<{ date: string, chat: number, image: number, total: number }[]>([]);
    
    useEffect(() => {
        if (!profile?.id) return;
        
        const fetchHistory = async () => {
            try {
                // In a full implementation, you'd merge tokens_by_feature here.
                // For now, map the tokens_by_day directly.
                const data = await api.getTokenAnalytics({ userId: profile.id, period: 'week' });
                if (data && data.tokens_by_day) {
                    const mapped = data.tokens_by_day.map((d: { date: string, tokens: number }) => ({
                        date: d.date,
                        chat: 0, // This could be enriched using tokens_by_feature later
                        image: 0,
                        total: d.tokens
                    })).slice(0, 5); // Keep to recent 5 days
                    
                    setUsageHistory(mapped.reverse());
                }
            } catch (err) {
                console.error("Failed to load token history", err);
            }
        };
        fetchHistory();
    }, [profile?.id]);
    
    const maxUsage = Math.max(...usageHistory.map(h => h.total), 1); // fallback to 1 to avoid div-by-zero
    
    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.title, { color: theme.colors.text }]}>Token Usage</Text>
                    <View style={{ width: 24 }} />
                </View>
                
                <ScrollView style={styles.content}>
                    {/* Current Balance */}
                    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.cardTitle, { color: theme.colors.textMuted }]}>
                            CURRENT BALANCE
                        </Text>
                        <Text style={[styles.balanceText, { color: theme.colors.primary }]}>
                            {tokenInfo?.tokensRemaining || 0}
                        </Text>
                        <Text style={[styles.balanceSubtext, { color: theme.colors.textMuted }]}>
                            of {tokenInfo?.tokensLimit || 100} tokens
                        </Text>
                        <View style={[styles.progressBar, { backgroundColor: theme.colors.surfaceLight }]}>
                            <View
                                style={[
                                    styles.progressFill,
                                    {
                                        width: `${((tokenInfo?.tokensRemaining || 0) / (tokenInfo?.tokensLimit || 100)) * 100}%`,
                                        backgroundColor: tokenInfo?.isLow ? theme.colors.error : theme.colors.primary,
                                    },
                                ]}
                            />
                        </View>
                    </View>
                    
                    {/* Usage Chart */}
                    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.cardTitle, { color: theme.colors.textMuted }]}>
                            USAGE HISTORY (LAST 5 DAYS)
                        </Text>
                        <View style={styles.chart}>
                            {usageHistory.map((day, index) => (
                                <View key={day.date} style={styles.chartBar}>
                                    <View style={styles.barContainer}>
                                        <View
                                            style={[
                                                styles.bar,
                                                {
                                                    height: `${(day.total / maxUsage) * 100}%`,
                                                    backgroundColor: theme.colors.primary,
                                                },
                                            ]}
                                        />
                                    </View>
                                    <Text style={[styles.barLabel, { color: theme.colors.textMuted }]}>
                                        {new Date(day.date).getDate()}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>
                    
                    {/* Breakdown */}
                    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.cardTitle, { color: theme.colors.textMuted }]}>
                            BREAKDOWN BY TYPE
                        </Text>
                        {usageHistory.map((day) => (
                            <View key={day.date} style={styles.breakdownItem}>
                                <Text style={[styles.breakdownDate, { color: theme.colors.text }]}>
                                    {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </Text>
                                <View style={styles.breakdownStats}>
                                    <Text style={[styles.breakdownStat, { color: theme.colors.textMuted }]}>
                                        💬 {day.chat}
                                    </Text>
                                    <Text style={[styles.breakdownStat, { color: theme.colors.textMuted }]}>
                                        🎨 {day.image}
                                    </Text>
                                    <Text style={[styles.breakdownTotal, { color: theme.colors.primary }]}>
                                        Total: {day.total}
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>
                </ScrollView>
            </SafeAreaView>
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
    title: { fontSize: fontSize.xl, fontWeight: '700' },
    content: { flex: 1 },
    card: {
        margin: spacing.lg,
        padding: spacing.lg,
        borderRadius: borderRadius.lg,
    },
    cardTitle: {
        fontSize: fontSize.xs,
        fontWeight: '600',
        letterSpacing: 1,
        marginBottom: spacing.md,
    },
    balanceText: {
        fontSize: 48,
        fontWeight: '700',
        textAlign: 'center',
    },
    balanceSubtext: {
        fontSize: fontSize.sm,
        textAlign: 'center',
        marginBottom: spacing.md,
    },
    progressBar: {
        height: 8,
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 4,
    },
    chart: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'flex-end',
        height: 150,
        paddingVertical: spacing.md,
    },
    chartBar: {
        flex: 1,
        alignItems: 'center',
    },
    barContainer: {
        width: 30,
        height: 120,
        justifyContent: 'flex-end',
    },
    bar: {
        width: '100%',
        borderRadius: 4,
        minHeight: 4,
    },
    barLabel: {
        fontSize: fontSize.xs,
        marginTop: spacing.xs,
    },
    breakdownItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: '#00000010',
    },
    breakdownDate: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    breakdownStats: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    breakdownStat: {
        fontSize: fontSize.xs,
    },
    breakdownTotal: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
});
