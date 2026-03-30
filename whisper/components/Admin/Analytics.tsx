/**
 * Analytics Dashboard Component for Admin
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '@/constants/theme';
import { LineChart, BarChart, PieChart } from 'react-native-chart-kit';

interface AnalyticsProps {
    serverUrl: string;
    adminToken: string;
}

export function Analytics({ serverUrl, adminToken }: AnalyticsProps) {
    const { theme } = useTheme();
    const [analytics, setAnalytics] = useState<any>(null);
    const screenWidth = Dimensions.get('window').width;

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const fetchAnalytics = async () => {
        try {
            const response = await fetch(`${serverUrl}/api/admin/analytics`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            const data = await response.json();
            if (data.success) {
                setAnalytics(data);
            }
        } catch (e) {
            console.error('Failed to fetch analytics:', e);
        }
    };

    const chartConfig = {
        backgroundColor: theme.colors.surface,
        backgroundGradientFrom: theme.colors.surface,
        backgroundGradientTo: theme.colors.surface,
        decimalPlaces: 0,
        color: (opacity = 1) => `rgba(99, 102, 241, ${opacity})`,
        labelColor: (opacity = 1) => theme.colors.text + Math.round(opacity * 255).toString(16),
        style: {
            borderRadius: borderRadius.md,
        },
    };

    return (
        <ScrollView style={styles.container}>
            {/* Daily Active Users */}
            <View style={styles.chartCard}>
                <Text style={[styles.chartTitle, { color: theme.colors.text }]}>
                    Daily Active Users (Last 7 Days)
                </Text>
                {analytics?.dau && (
                    <LineChart
                        data={{
                            labels: analytics.dau.labels,
                            datasets: [{
                                data: analytics.dau.data
                            }]
                        }}
                        width={screenWidth - spacing.xl * 2}
                        height={220}
                        chartConfig={chartConfig}
                        bezier
                        style={styles.chart}
                    />
                )}
            </View>

            {/* API Usage */}
            <View style={styles.chartCard}>
                <Text style={[styles.chartTitle, { color: theme.colors.text }]}>
                    API Usage by Endpoint
                </Text>
                {analytics?.api_usage && (
                    <BarChart
                        data={{
                            labels: analytics.api_usage.labels,
                            datasets: [{
                                data: analytics.api_usage.data
                            }]
                        }}
                        width={screenWidth - spacing.xl * 2}
                        height={220}
                        chartConfig={chartConfig}
                        style={styles.chart}
                        yAxisLabel=""
                        yAxisSuffix=""
                    />
                )}
            </View>

            {/* Feature Popularity */}
            <View style={styles.chartCard}>
                <Text style={[styles.chartTitle, { color: theme.colors.text }]}>
                    Feature Popularity
                </Text>
                {analytics?.features && (
                    <PieChart
                        data={analytics.features}
                        width={screenWidth - spacing.xl * 2}
                        height={220}
                        chartConfig={chartConfig}
                        accessor="usage"
                        backgroundColor="transparent"
                        paddingLeft="15"
                        style={styles.chart}
                    />
                )}
            </View>

            {/* Stats Cards */}
            <View style={styles.statsGrid}>
                <View style={[styles.statCard, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.statValue, { color: theme.colors.primary }]}>
                        {analytics?.total_users || 0}
                    </Text>
                    <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>
                        Total Users
                    </Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.statValue, { color: theme.colors.success }]}>
                        {analytics?.revenue || '$0'}
                    </Text>
                    <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>
                        Revenue (MTD)
                    </Text>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    chartCard: {
        marginBottom: spacing.lg,
        padding: spacing.md,
    },
    chartTitle: {
        fontSize: fontSize.lg,
        fontWeight: '600',
        marginBottom: spacing.md,
    },
    chart: {
        borderRadius: borderRadius.md,
    },
    statsGrid: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    statCard: {
        flex: 1,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        alignItems: 'center',
    },
    statValue: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    statLabel: {
        fontSize: fontSize.sm,
        marginTop: spacing.xs,
    },
});
