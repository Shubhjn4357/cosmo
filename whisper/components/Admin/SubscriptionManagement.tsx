/**
 * Subscription Management Component for Admin Dashboard
 */

import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, fontSize, borderRadius } from '@/constants/theme';

interface SubscriptionPlan {
    id: string;
    name: string;
    price: number;
    currency: string;
    features: string[];
    active: boolean;
    subscriber_count?: number;
}

interface SubscriptionManagementProps {
    serverUrl: string;
    adminToken: string;
}

export function SubscriptionManagement({ serverUrl, adminToken }: SubscriptionManagementProps) {
    const { theme } = useTheme();
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [editedPlan, setEditedPlan] = useState<Partial<SubscriptionPlan>>({});

    useEffect(() => {
        fetchPlans();
    }, []);

    const fetchPlans = async () => {
        try {
            const response = await fetch(`${serverUrl}/api/admin/subscriptions`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            const data = await response.json();
            if (data.success) {
                setPlans(data.plans);
            }
        } catch (e) {
            console.error('Failed to fetch plans:', e);
        }
    };

    const savePlan = async () => {
        try {
            const endpoint = selectedPlan
                ? `${serverUrl}/api/admin/subscriptions/${selectedPlan.id}/update`
                : `${serverUrl}/api/admin/subscriptions/create`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(editedPlan)
            });

            const data = await response.json();
            if (data.success) {
                fetchPlans();
                setEditMode(false);
                setSelectedPlan(null);
                setEditedPlan({});
            }
        } catch (e) {
            console.error('Failed to save plan:', e);
        }
    };

    return (
        <View style={styles.container}>
            {/* Plans List */}
            <FlatList
                data={plans}
                keyExtractor={item => item.id}
                ListHeaderComponent={
                    <TouchableOpacity
                        style={[styles.createBtn, { backgroundColor: theme.colors.primary }]}
                        onPress={() => {
                            setEditMode(true);
                            setSelectedPlan(null);
                            setEditedPlan({ active: true });
                        }}
                    >
                        <Ionicons name="add-circle" size={20} color="#FFFFFF" />
                        <Text style={styles.createBtnText}>Create New Plan</Text>
                    </TouchableOpacity>
                }
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={[styles.planItem, { backgroundColor: theme.colors.surface }]}
                        onPress={() => {
                            setSelectedPlan(item);
                            setEditedPlan(item);
                            setEditMode(false);
                        }}
                    >
                        <View style={styles.planHeader}>
                            <Text style={[styles.planName, { color: theme.colors.text }]}>
                                {item.name}
                            </Text>
                            <Text style={[styles.planPrice, { color: theme.colors.primary }]}>
                                {item.currency}{item.price}/mo
                            </Text>
                        </View>
                        <View style={styles.planStats}>
                            <Text style={[styles.statText, { color: theme.colors.textMuted }]}>
                                {item.subscriber_count || 0} subscribers
                            </Text>
                            <View style={[styles.statusBadge, {
                                backgroundColor: item.active ? '#4CAF50' : '#EF4444'
                            }]}>
                                <Text style={styles.statusText}>
                                    {item.active ? 'ACTIVE' : 'INACTIVE'}
                                </Text>
                            </View>
                        </View>
                    </TouchableOpacity>
                )}
            />

            {/* Edit Modal */}
            <Modal visible={!!selectedPlan || editMode} transparent animationType="slide">
                <View style={styles.modalContainer}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.background }]}>
                        <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                            {editMode ? 'Edit Plan' : 'Plan Details'}
                        </Text>

                        {editMode ? (
                            <>
                                <TextInput
                                    style={[styles.input, { backgroundColor: theme.colors.surface, color: theme.colors.text }]}
                                    placeholder="Plan Name"
                                    value={editedPlan.name || ''}
                                    onChangeText={text => setEditedPlan({ ...editedPlan, name: text })}
                                />
                                <TextInput
                                    style={[styles.input, { backgroundColor: theme.colors.surface, color: theme.colors.text }]}
                                    placeholder="Price"
                                    keyboardType="numeric"
                                    value={editedPlan.price?.toString() || ''}
                                    onChangeText={text => setEditedPlan({ ...editedPlan, price: parseInt(text) || 0 })}
                                />

                                <View style={styles.actions}>
                                    <TouchableOpacity
                                        style={[styles.actionBtn, { backgroundColor: theme.colors.primary }]}
                                        onPress={savePlan}
                                    >
                                        <Text style={styles.actionBtnText}>Save</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.actionBtn, { backgroundColor: theme.colors.surface }]}
                                        onPress={() => {
                                            setEditMode(false);
                                            setSelectedPlan(null);
                                        }}
                                    >
                                        <Text style={[styles.actionBtnText, { color: theme.colors.text }]}>
                                            Cancel
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </>
                        ) : selectedPlan && (
                            <>
                                <Text style={[styles.detailText, { color: theme.colors.text }]}>
                                    {selectedPlan.name}
                                </Text>
                                <Text style={[styles.detailText, { color: theme.colors.text }]}>
                                    Price: {selectedPlan.currency}{selectedPlan.price}/month
                                </Text>
                                <Text style={[styles.detailText, { color: theme.colors.text }]}>
                                    Subscribers: {selectedPlan.subscriber_count || 0}
                                </Text>

                                <TouchableOpacity
                                    style={[styles.actionBtn, { backgroundColor: theme.colors.primary }]}
                                    onPress={() => setEditMode(true)}
                                >
                                    <Text style={styles.actionBtnText}>Edit Plan</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.closeBtn, { backgroundColor: theme.colors.surface }]}
                                    onPress={() => setSelectedPlan(null)}
                                >
                                    <Text style={[styles.closeBtnText, { color: theme.colors.text }]}>Close</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    createBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.md,
        gap: spacing.sm,
    },
    createBtnText: {
        color: '#FFFFFF',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    planItem: {
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderRadius: borderRadius.md,
    },
    planHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
    },
    planName: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    planPrice: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    planStats: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statText: {
        fontSize: fontSize.sm,
    },
    statusBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xxl,
        borderRadius: borderRadius.sm,
    },
    statusText: {
        color: '#FFFFFF',
        fontSize: fontSize.xs,
        fontWeight: '700',
    },
    modalContainer: {
        flex: 1,
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: spacing.xl,
    },
    modalContent: {
        borderRadius: borderRadius.lg,
        padding: spacing.xl,
    },
    modalTitle: {
        fontSize: fontSize.xl,
        fontWeight: '700',
        marginBottom: spacing.lg,
    },
    input: {
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.sm,
    },
    detailText: {
        fontSize: fontSize.md,
        marginBottom: spacing.sm,
    },
    actions: {
        marginTop: spacing.lg,
        gap: spacing.sm,
    },
    actionBtn: {
        padding: spacing.md,
        borderRadius: borderRadius.md,
        alignItems: 'center',
    },
    actionBtnText: {
        color: '#FFFFFF',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    closeBtn: {
        marginTop: spacing.lg,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        alignItems: 'center',
    },
    closeBtnText: {
        fontSize: fontSize.md,
    },
});
