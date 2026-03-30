/**
 * User Management Component for Admin Dashboard
 */

import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, fontSize, borderRadius } from '@/constants/theme';

interface User {
    id: string;
    email: string;
    display_name: string;
    subscription_tier: 'free' | 'pro';
    created_at: string;
    banned: boolean;
}

interface UserManagementProps {
    serverUrl: string;
    adminToken: string;
}

export function UserManagement({ serverUrl, adminToken }: UserManagementProps) {
    const { theme } = useTheme();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${serverUrl}/api/admin/users`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            });
            const data = await response.json();
            if (data.success) {
                setUsers(data.users);
            }
        } catch (e) {
            console.error('Failed to fetch users:', e);
        }
        setLoading(false);
    };

    const upgradeUser = async (userId: string, tier: 'free' | 'pro') => {
        try {
            const response = await fetch(`${serverUrl}/api/admin/users/${userId}/subscription`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tier })
            });
            const data = await response.json();
            if (data.success) {
                fetchUsers();
                setSelectedUser(null);
            }
        } catch (e) {
            console.error('Failed to upgrade user:', e);
        }
    };

    const banUser = async (userId: string, banned: boolean) => {
        try {
            const response = await fetch(`${serverUrl}/api/admin/users/${userId}/ban`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ banned })
            });
            const data = await response.json();
            if (data.success) {
                fetchUsers();
                setSelectedUser(null);
            }
        } catch (e) {
            console.error('Failed to ban user:', e);
        }
    };

    const filteredUsers = users.filter(user =>
        user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.display_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <View style={styles.container}>
            {/* Search */}
            <TextInput
                style={[styles.searchInput, { backgroundColor: theme.colors.surface, color: theme.colors.text }]}
                placeholder="Search users..."
                placeholderTextColor={theme.colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
            />

            {/* User List */}
            <FlatList
                data={filteredUsers}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={[styles.userItem, { backgroundColor: theme.colors.surface }]}
                        onPress={() => setSelectedUser(item)}
                    >
                        <View style={styles.userInfo}>
                            <Text style={[styles.userName, { color: theme.colors.text }]}>
                                {item.display_name}
                            </Text>
                            <Text style={[styles.userEmail, { color: theme.colors.textMuted }]}>
                                {item.email}
                            </Text>
                        </View>
                        <View style={styles.userBadges}>
                            <View style={[styles.badge, {
                                backgroundColor: item.subscription_tier === 'pro' ? '#FFD700' : '#CCCCCC'
                            }]}>
                                <Text style={styles.badgeText}>
                                    {item.subscription_tier.toUpperCase()}
                                </Text>
                            </View>
                            {item.banned && (
                                <View style={[styles.badge, { backgroundColor: '#EF4444' }]}>
                                    <Text style={styles.badgeText}>BANNED</Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>
                )}
            />

            {/* User Details Modal */}
            <Modal visible={!!selectedUser} transparent animationType="slide">
                <View style={styles.modalContainer}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.background }]}>
                        <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                            User Details
                        </Text>

                        {selectedUser && (
                            <>
                                <Text style={[styles.detailText, { color: theme.colors.text }]}>
                                    Name: {selectedUser.display_name}
                                </Text>
                                <Text style={[styles.detailText, { color: theme.colors.text }]}>
                                    Email: {selectedUser.email}
                                </Text>
                                <Text style={[styles.detailText, { color: theme.colors.text }]}>
                                    Tier: {selectedUser.subscription_tier}
                                </Text>

                                {/* Actions */}
                                <View style={styles.actions}>
                                    <TouchableOpacity
                                        style={[styles.actionBtn, { backgroundColor: '#FFD700' }]}
                                        onPress={() => upgradeUser(selectedUser.id, 'pro')}
                                    >
                                        <Text style={styles.actionBtnText}>Upgrade to Pro</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[styles.actionBtn, { backgroundColor: '#EF4444' }]}
                                        onPress={() => banUser(selectedUser.id, !selectedUser.banned)}
                                    >
                                        <Text style={styles.actionBtnText}>
                                            {selectedUser.banned ? 'Unban' : 'Ban'} User
                                        </Text>
                                    </TouchableOpacity>
                                </View>

                                <TouchableOpacity
                                    style={[styles.closeBtn, { backgroundColor: theme.colors.surface }]}
                                    onPress={() => setSelectedUser(null)}
                                >
                                    <Text style={[styles.closeBtnText, { color: theme.colors.text }]}>
                                        Close
                                    </Text>
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
    searchInput: {
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.md,
    },
    userItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderRadius: borderRadius.md,
    },
    userInfo: {
        flex: 1,
    },
    userName: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    userEmail: {
        fontSize: fontSize.sm,
        marginTop: spacing.xs,
    },
    userBadges: {
        flexDirection: 'row',
        gap: spacing.xs,
    },
    badge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xxl,
        borderRadius: borderRadius.sm,
    },
    badgeText: {
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
