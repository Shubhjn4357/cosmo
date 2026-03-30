/**
 * Whisper App - Responsive Sidebar
 * Gemini-style sidebar for tablets/web with chat history
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Animated,
    Dimensions,
    Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize, isTablet, isLargeScreen } from '@/constants/theme';
import { useAuth } from '@/hooks';
import { historyAPI, ChatHistory } from '@/services/profileAPI';

const SIDEBAR_WIDTH = 280;

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    onNewChat: () => void;
    currentChatId?: string | null;
    onSelectChat: (chatId: string) => void;
}

export default function Sidebar({
    isOpen,
    onClose,
    onNewChat,
    currentChatId,
    onSelectChat,
}: SidebarProps) {
    const { theme, isDark } = useTheme();
    const router = useRouter();
    const { user, profile, signOut } = useAuth();
    const [history, setHistory] = useState<ChatHistory[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const slideAnim = useState(new Animated.Value(isOpen ? 0 : -SIDEBAR_WIDTH))[0];

    useEffect(() => {
        Animated.spring(slideAnim, {
            toValue: isOpen ? 0 : - SIDEBAR_WIDTH,
            useNativeDriver: true,
            damping: 20,
            stiffness: 200,
        }).start();
    }, [isOpen]);

    useEffect(() => {
        if (user && isOpen) {
            loadHistory();
        }
    }, [user, isOpen]);

    const loadHistory = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const chats = await historyAPI.getHistories(user.id);
            setHistory(chats);
        } catch (error) {
            console.error('Error loading history:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogout = async () => {
        await signOut();
        router.replace('/auth/login');
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        return date.toLocaleDateString();
    };

    // Group history by date
    const groupedHistory = history.reduce((acc, chat) => {
        const date = formatDate(chat.updated_at);
        if (!acc[date]) acc[date] = [];
        acc[date].push(chat);
        return acc;
    }, {} as Record<string, ChatHistory[]>);

    // For non-tablet, render as overlay
    if (!isTablet) {
        if (!isOpen) return null;
        return (
            <TouchableOpacity
                style={styles.overlay}
                activeOpacity={1}
                onPress={onClose}
            >
                <Animated.View
                    style={[
                        styles.sidebarMobile,
                        {
                            backgroundColor: theme.colors.sidebar,
                            borderRightColor: theme.colors.sidebarBorder,
                            transform: [{ translateX: slideAnim }],
                        },
                    ]}
                >
                    <TouchableOpacity activeOpacity={1} style={styles.sidebarInner}>
                        <SidebarContent
                            theme={theme}
                            isDark={isDark}
                            profile={profile}
                            history={groupedHistory}
                            isLoading={isLoading}
                            currentChatId={currentChatId}
                            onNewChat={onNewChat}
                            onSelectChat={onSelectChat}
                            onLogout={handleLogout}
                            router={router}
                        />
                    </TouchableOpacity>
                </Animated.View>
            </TouchableOpacity>
        );
    }

    // For tablet/desktop, render as fixed sidebar
    return (
        <View
            style={[
                styles.sidebarFixed,
                {
                    backgroundColor: theme.colors.sidebar,
                    borderRightColor: theme.colors.sidebarBorder,
                },
            ]}
        >
            <SidebarContent
                theme={theme}
                isDark={isDark}
                profile={profile}
                history={groupedHistory}
                isLoading={isLoading}
                currentChatId={currentChatId}
                onNewChat={onNewChat}
                onSelectChat={onSelectChat}
                onLogout={handleLogout}
                router={router}
            />
        </View>
    );
}

// Sidebar content component
function SidebarContent({
    theme,
    isDark,
    profile,
    history,
    isLoading,
    currentChatId,
    onNewChat,
    onSelectChat,
    onLogout,
    router,
}: any) {
    return (
        <>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.logoRow}>
                    <View style={[styles.logoCircle, { backgroundColor: theme.colors.primary + '20' }]}>
                        <Ionicons name="sparkles" size={20} color={theme.colors.primary} />
                    </View>
                    <Text style={[styles.logoText, { color: theme.colors.text }]}>Whisper AI</Text>
                </View>
                <TouchableOpacity
                    style={[styles.newChatBtn, { backgroundColor: theme.colors.primary }]}
                    onPress={onNewChat}
                >
                    <Ionicons name="add" size={20} color="#000" />
                    <Text style={styles.newChatText}>New Chat</Text>
                </TouchableOpacity>
            </View>

            {/* History */}
            <ScrollView style={styles.historyContainer} showsVerticalScrollIndicator={false}>
                {isLoading ? (
                    <Text style={[styles.loadingText, { color: theme.colors.textMuted }]}>
                        Loading...
                    </Text>
                ) : Object.keys(history).length === 0 ? (
                    <View style={styles.emptyState}>
                        <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.textMuted} />
                        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
                            No chat history
                        </Text>
                    </View>
                ) : (
                    Object.entries(history).map(([date, chats]) => (
                        <View key={date} style={styles.historyGroup}>
                            <Text style={[styles.historyDate, { color: theme.colors.textMuted }]}>
                                {date}
                            </Text>
                            {(chats as ChatHistory[]).map((chat) => (
                                <TouchableOpacity
                                    key={chat.id}
                                    style={[
                                        styles.historyItem,
                                        currentChatId === chat.id && {
                                            backgroundColor: theme.colors.primary + '15',
                                        },
                                    ]}
                                    onPress={() => onSelectChat(chat.id)}
                                >
                                    <Ionicons
                                        name={chat.is_local ? 'phone-portrait-outline' : 'cloud-outline'}
                                        size={16}
                                        color={currentChatId === chat.id ? theme.colors.primary : theme.colors.textMuted}
                                    />
                                    <Text
                                        style={[
                                            styles.historyTitle,
                                            { color: currentChatId === chat.id ? theme.colors.primary : theme.colors.text },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {chat.title}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    ))
                )}
            </ScrollView>

            {/* Footer */}
            <View style={[styles.footer, { borderTopColor: theme.colors.sidebarBorder }]}>
                {/* Token Status */}
                {profile && (
                    <TouchableOpacity
                        style={[styles.tokenCard, { backgroundColor: theme.colors.surfaceLight }]}
                        onPress={() => router.push('/subscription')}
                    >
                        <View style={styles.tokenRow}>
                            <Ionicons name="flash" size={16} color={theme.colors.primary} />
                            <Text style={[styles.tokenText, { color: theme.colors.text }]}>
                                {profile.tokens_used}/{profile.tokens_limit} tokens
                            </Text>
                        </View>
                        <View style={[styles.tokenBar, { backgroundColor: theme.colors.surfaceBorder }]}>
                            <View
                                style={[
                                    styles.tokenFill,
                                    {
                                        backgroundColor: theme.colors.primary,
                                        width: `${(profile.tokens_used / profile.tokens_limit) * 100}%`,
                                    },
                                ]}
                            />
                        </View>
                        {profile.subscription_tier === 'free' && (
                            <Text style={[styles.upgradeHint, { color: theme.colors.primary }]}>
                                Upgrade to Pro →
                            </Text>
                        )}
                    </TouchableOpacity>
                )}

                {/* Profile & Logout */}
                <View style={styles.userRow}>
                    <View style={styles.userInfo}>
                        <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
                            <Text style={styles.avatarText}>
                                {profile?.display_name?.[0]?.toUpperCase() || 'U'}
                            </Text>
                        </View>
                        <View style={styles.userTextContainer}>
                            <Text style={[styles.userName, { color: theme.colors.text }]} numberOfLines={1}>
                                {profile?.display_name || 'User'}
                            </Text>
                            <Text style={[styles.userTier, { color: theme.colors.textMuted }]}>
                                {profile?.subscription_tier === 'pro' ? 'Pro' : 'Free'} Plan
                            </Text>
                        </View>
                    </View>
                    <TouchableOpacity onPress={onLogout} style={styles.logoutBtn}>
                        <Ionicons name="log-out-outline" size={20} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                </View>
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 100,
    },
    sidebarMobile: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        borderRightWidth: 1,
    },
    sidebarFixed: {
        width: SIDEBAR_WIDTH,
        height: '100%',
        borderRightWidth: 1,
    },
    sidebarInner: {
        flex: 1,
    },
    header: {
        padding: spacing.md,
        gap: spacing.md,
    },
    logoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    logoCircle: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoText: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    newChatBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.sm + 2,
        borderRadius: borderRadius.lg,
        gap: spacing.xs,
    },
    newChatText: {
        color: '#000',
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
    historyContainer: {
        flex: 1,
        paddingHorizontal: spacing.sm,
    },
    historyGroup: {
        marginBottom: spacing.md,
    },
    historyDate: {
        fontSize: fontSize.xs,
        fontWeight: '600',
        paddingHorizontal: spacing.sm,
        marginBottom: spacing.xs,
        textTransform: 'uppercase',
    },
    historyItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderRadius: borderRadius.md,
    },
    historyTitle: {
        flex: 1,
        fontSize: fontSize.sm,
    },
    loadingText: {
        textAlign: 'center',
        marginTop: spacing.lg,
        fontSize: fontSize.sm,
    },
    emptyState: {
        alignItems: 'center',
        marginTop: spacing.xxl,
        gap: spacing.sm,
    },
    emptyText: {
        fontSize: fontSize.sm,
    },
    footer: {
        padding: spacing.md,
        borderTopWidth: 1,
        gap: spacing.md,
    },
    tokenCard: {
        padding: spacing.sm,
        borderRadius: borderRadius.md,
        gap: spacing.xs,
    },
    tokenRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    tokenText: {
        fontSize: fontSize.xs,
        fontWeight: '500',
    },
    tokenBar: {
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    tokenFill: {
        height: '100%',
    },
    upgradeHint: {
        fontSize: fontSize.xs,
        fontWeight: '600',
        marginTop: 2,
    },
    userRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    userInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        flex: 1,
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarText: {
        color: '#000',
        fontWeight: '700',
        fontSize: fontSize.sm,
    },
    userTextContainer: {
        flex: 1,
    },
    userName: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
    userTier: {
        fontSize: fontSize.xs,
    },
    logoutBtn: {
        padding: spacing.sm,
    },
});
