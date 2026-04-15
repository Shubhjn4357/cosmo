/**
 * Model Management Component for Admin Dashboard
 */

import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, fontSize, borderRadius } from '@/constants/theme';

interface Model {
    id: string;
    name: string;
    type: 'llm' | 'image' | 'provider';
    enabled: boolean;
    performance?: {
        avg_response_time_ms?: number | null;
        requests_today: number;
    };
}

interface ModelManagementProps {
    serverUrl: string;
    adminToken: string;
}

export function ModelManagement({ serverUrl, adminToken }: ModelManagementProps) {
    const { theme } = useTheme();
    const [models, setModels] = useState<Model[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchModels();
    }, []);

    const fetchModels = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${serverUrl}/api/admin/models`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            const data = await response.json();
            if (data.success) {
                setModels(data.models);
            }
        } catch (e) {
            console.error('Failed to fetch models:', e);
        }
        setLoading(false);
    };

    const toggleModel = async (modelId: string, enabled: boolean) => {
        try {
            const response = await fetch(`${serverUrl}/api/admin/models/${modelId}/toggle`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled })
            });
            const data = await response.json();
            if (data.success) {
                fetchModels();
            }
        } catch (e) {
            console.error('Failed to toggle model:', e);
        }
    };

    return (
        <View style={styles.container}>
            <FlatList
                data={models}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                    <View style={[styles.modelItem, { backgroundColor: theme.colors.surface }]}>
                        <View style={styles.modelInfo}>
                            <Text style={[styles.modelName, { color: theme.colors.text }]}>
                                {item.name}
                            </Text>
                            <Text style={[styles.modelType, { color: theme.colors.textMuted }]}>
                                {item.type.toUpperCase()}
                            </Text>
                            {item.performance && (
                                <Text style={[styles.perfText, { color: theme.colors.textMuted }]}>
                                    {item.performance.avg_response_time_ms ?? 0}ms avg • {item.performance.requests_today} requests today
                                </Text>
                            )}
                        </View>
                        <Switch
                            value={item.enabled}
                            onValueChange={(enabled) => toggleModel(item.id, enabled)}
                            trackColor={{ false: theme.colors.surfaceLight, true: theme.colors.primary }}
                            thumbColor="#fff"
                        />
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    modelItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderRadius: borderRadius.md,
    },
    modelInfo: {
        flex: 1,
    },
    modelName: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    modelType: {
        fontSize: fontSize.xs,
        marginTop: 2,
    },
    perfText: {
        fontSize: fontSize.xs,
        marginTop: spacing.xs,
    },
});
