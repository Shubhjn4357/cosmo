/**
 * Cosmo App - Notification Bell Component
 * Shows unread notification count and dropdown list
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    TouchableWithoutFeedback,
    FlatList,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { useAuth } from '@/hooks';

interface Notification {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'success' | 'error';
    read: boolean;
    created_at: string;
}

export function NotificationBell() {
    const { theme } = useTheme();
    const { user } = useAuth();
    const [visible, setVisible] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(false);

    const unreadCount = notifications.filter(n => !n.read).length;

    const loadNotifications = async () => {
        if (!user?.id) return;
        
        setLoading(true);
        try {
            // API call to be implemented when backend is ready
            // const data = await notificationAPI.getNotifications(user.id);
            // setNotifications(data);
            
            // Mock data for now
            setNotifications([]);
        } catch (error) {
            console.error('Failed to load notifications:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (visible) {
            loadNotifications();
        }
    }, [visible]);

    const markAsRead = async (id: string) => {
        try {
            // API call to be implemented
            // await notificationAPI.markAsRead(id);
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, read: true } : n)
            );
        } catch (error) {
            console.error('Failed to mark as read:', error);
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'success': return 'checkmark-circle';
            case 'error': return 'alert-circle';
            case 'warning': return 'warning';
            default: return 'information-circle';
        }
    };

    const getColor = (type: string) => {
        switch (type) {
            case 'success': return theme.colors.success;
            case 'error': return theme.colors.error;
            case 'warning': return theme.colors.warning;
            default: return theme.colors.primary;
        }
    };

    return (
        <>
            <TouchableOpacity onPress={() => setVisible(true)} style={styles.bellButton}>
                <Ionicons name="notifications-outline" size={24} color={theme.colors.text} />
                {unreadCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: theme.colors.error }]}>
                        <Text style={styles.badgeText}>
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </Text>
                    </View>
                )}
            </TouchableOpacity>

            <Modal
                visible={visible}
                transparent
                animationType="fade"
                onRequestClose={() => setVisible(false)}
            >
                <TouchableWithoutFeedback onPress={() => setVisible(false)}>
                    <View style={styles.overlay}>
                        <TouchableWithoutFeedback>
                            <View
                                style={[
                                    styles.dropdown,
                                    {
                                        backgroundColor: theme.colors.surface,
                                        borderColor: theme.colors.surfaceBorder,
                                    }
                                ]}
                            >
                                <View style={styles.header}>
                                    <Text style={[styles.title, { color: theme.colors.text }]}>
                                        Notifications
                                    </Text>
                                    <TouchableOpacity onPress={() => setVisible(false)}>
                                        <Ionicons name="close" size={24} color={theme.colors.textMuted} />
                                    </TouchableOpacity>
                                </View>

                                {loading ? (
                                    <View style={styles.loadingContainer}>
                                        <ActivityIndicator color={theme.colors.primary} />
                                    </View>
                                ) : notifications.length === 0 ? (
                                    <View style={styles.emptyContainer}>
                                        <Ionicons name="notifications-off-outline" size={48} color={theme.colors.textMuted} />
                                        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
                                            No notifications
                                        </Text>
                                    </View>
                                ) : (
                                    <FlatList
                                        data={notifications}
                                        keyExtractor={item => item.id}
                                        renderItem={({ item }) => (
                                            <TouchableOpacity
                                                onPress={() => markAsRead(item.id)}
                                                style={[
                                                    styles.notificationItem,
                                                    { backgroundColor: item.read ? 'transparent' : theme.colors.surfaceLight }
                                                ]}
                                            >
                                                <View style={styles.notificationContent}>
                                                    <Ionicons
                                                        name={getIcon(item.type) as any}
                                                        size={24}
                                                        color={getColor(item.type)}
                                                    />
                                                    <View style={styles.notificationText}>
                                                        <Text style={[styles.notificationTitle, { color: theme.colors.text }]}>
                                                            {item.title}
                                                        </Text>
                                                        <Text style={[styles.notificationMessage, { color: theme.colors.textMuted }]}>
                                                            {item.message}
                                                        </Text>
                                                        <Text style={[styles.notificationDate, { color: theme.colors.textMuted }]}>
                                                            {new Date(item.created_at).toLocaleDateString()}
                                                        </Text>
                                                    </View>
                                                </View>
                                                {!item.read && (
                                                    <View style={[styles.unreadDot, { backgroundColor: theme.colors.primary }]} />
                                                )}
                                            </TouchableOpacity>
                                        )}
                                    />
                                )}
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    bellButton: {
        position: 'relative',
        padding: spacing.xs,
    },
    badge: {
        position: 'absolute',
        top: 0,
        right: 0,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    badgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-start',
        paddingTop: 60,
        paddingHorizontal: spacing.md,
    },
    dropdown: {
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        maxHeight: 400,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.1)',
    },
    title: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    loadingContainer: {
        padding: spacing.xl,
        alignItems: 'center',
    },
    emptyContainer: {
        padding: spacing.xl,
        alignItems: 'center',
        gap: spacing.sm,
    },
    emptyText: {
        fontSize: fontSize.md,
    },
    notificationItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    notificationContent: {
        flexDirection: 'row',
        gap: spacing.sm,
        flex: 1,
    },
    notificationText: {
        flex: 1,
    },
    notificationTitle: {
        fontSize: fontSize.md,
        fontWeight: '600',
        marginBottom: spacing.xs / 2,
    },
    notificationMessage: {
        fontSize: fontSize.sm,
        marginBottom: spacing.xs / 2,
    },
    notificationDate: {
        fontSize: fontSize.xs,
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
});
