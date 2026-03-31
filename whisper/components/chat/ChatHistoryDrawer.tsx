import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ChatHistory } from '@/types';
import { borderRadius, fontSize, spacing, useTheme } from '@/constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRAWER_HEIGHT = Math.min(SCREEN_HEIGHT * 0.72, 560);

interface ChatHistoryDrawerProps {
    visible: boolean;
    onClose: () => void;
    histories: ChatHistory[];
    onSelectHistory: (history: ChatHistory) => void;
    onDeleteHistory?: (historyId: string) => void;
    onNewChat?: () => void;
}

function groupByDate(histories: ChatHistory[]) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    const groups: Record<string, ChatHistory[]> = {
        Today: [],
        Yesterday: [],
        'This Week': [],
        Older: [],
    };

    for (const history of histories) {
        const createdAt = new Date(history.createdAt);
        if (createdAt >= today) {
            groups.Today.push(history);
        } else if (createdAt >= yesterday) {
            groups.Yesterday.push(history);
        } else if (createdAt >= weekAgo) {
            groups['This Week'].push(history);
        } else {
            groups.Older.push(history);
        }
    }

    return groups;
}

export function ChatHistoryDrawer({
    visible,
    onClose,
    histories,
    onSelectHistory,
    onDeleteHistory,
    onNewChat,
}: ChatHistoryDrawerProps) {
    const { theme, isDark } = useTheme();
    const [searchQuery, setSearchQuery] = useState('');
    const slideAnim = useRef(new Animated.Value(DRAWER_HEIGHT)).current;
    const overlayOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(slideAnim, {
                    toValue: 0,
                    useNativeDriver: true,
                    tension: 70,
                    friction: 12,
                }),
                Animated.timing(overlayOpacity, {
                    toValue: 1,
                    duration: 180,
                    useNativeDriver: true,
                }),
            ]).start();
            return;
        }

        Animated.parallel([
            Animated.timing(slideAnim, {
                toValue: DRAWER_HEIGHT,
                duration: 180,
                useNativeDriver: true,
            }),
            Animated.timing(overlayOpacity, {
                toValue: 0,
                duration: 160,
                useNativeDriver: true,
            }),
        ]).start();
    }, [overlayOpacity, slideAnim, visible]);

    const filteredHistories = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return histories;
        return histories.filter((history) => (
            history.title.toLowerCase().includes(query)
            || history.messages.some((message) => message.text.toLowerCase().includes(query))
        ));
    }, [histories, searchQuery]);

    const groupedHistories = useMemo(() => groupByDate(filteredHistories), [filteredHistories]);

    if (!visible) return null;

    return (
        <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
            <View style={styles.modalRoot}>
                <TouchableWithoutFeedback onPress={onClose}>
                    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} />
                </TouchableWithoutFeedback>

                <Animated.View
                    style={[
                        styles.drawer,
                        {
                            backgroundColor: isDark ? 'rgba(15, 15, 25, 0.98)' : 'rgba(250, 250, 252, 0.98)',
                            borderColor: theme.colors.surfaceBorder,
                            transform: [{ translateY: slideAnim }],
                        },
                    ]}
                >
                    <View style={styles.handleRow}>
                        <View style={[styles.handle, { backgroundColor: theme.colors.surfaceBorder }]} />
                    </View>

                    <View style={styles.header}>
                        <View>
                            <Text style={[styles.title, { color: theme.colors.text }]}>History</Text>
                            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                                Pick up where you left off.
                            </Text>
                        </View>
                        <View style={styles.headerActions}>
                            {onNewChat && (
                                <TouchableOpacity
                                    style={[styles.headerButton, { backgroundColor: theme.colors.primary }]}
                                    onPress={onNewChat}
                                >
                                    <Ionicons name="add" size={18} color="#fff" />
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity
                                style={[styles.headerButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={onClose}
                            >
                                <Ionicons name="close" size={18} color={theme.colors.text} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={[styles.searchBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                        <Ionicons name="search" size={16} color={theme.colors.textMuted} />
                        <TextInput
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="Search history"
                            placeholderTextColor={theme.colors.textMuted}
                            style={[styles.searchInput, { color: theme.colors.text }]}
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={16} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        )}
                    </View>

                    <ScrollView
                        style={styles.historyList}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.historyListContent}
                    >
                        {Object.entries(groupedHistories).map(([group, entries]) => (
                            entries.length > 0 ? (
                                <View key={group} style={styles.group}>
                                    <Text style={[styles.groupTitle, { color: theme.colors.textMuted }]}>{group}</Text>
                                    {entries.map((history) => {
                                        const preview = history.messages
                                            .filter((message) => message.isUser)
                                            .slice(-1)[0]?.text
                                            || history.messages.slice(-1)[0]?.text
                                            || 'No preview';

                                        return (
                                            <TouchableOpacity
                                                key={history.id}
                                                style={[styles.historyCard, { backgroundColor: theme.colors.surface }]}
                                                onPress={() => onSelectHistory(history)}
                                                onLongPress={() => onDeleteHistory?.(history.id)}
                                            >
                                                <View style={styles.historyCardHeader}>
                                                    <Text style={[styles.historyTitle, { color: theme.colors.text }]} numberOfLines={1}>
                                                        {history.title}
                                                    </Text>
                                                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
                                                </View>
                                                <Text style={[styles.historyPreview, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                                                    {preview}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            ) : null
                        ))}

                        {filteredHistories.length === 0 && (
                            <View style={styles.emptyState}>
                                <Ionicons name="time-outline" size={36} color={theme.colors.textMuted} />
                                <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>No history yet</Text>
                                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                    Your real conversations will show up here without duplicates.
                                </Text>
                            </View>
                        )}
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalRoot: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    drawer: {
        height: DRAWER_HEIGHT,
        borderTopLeftRadius: borderRadius.xl,
        borderTopRightRadius: borderRadius.xl,
        borderWidth: 1,
        borderBottomWidth: 0,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.lg,
    },
    handleRow: {
        alignItems: 'center',
        paddingVertical: spacing.sm,
    },
    handle: {
        width: 44,
        height: 5,
        borderRadius: 999,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
    },
    title: {
        fontSize: fontSize.xl,
        fontWeight: '700',
    },
    subtitle: {
        fontSize: fontSize.sm,
        marginTop: spacing.xs,
    },
    headerActions: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    headerButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        marginBottom: spacing.md,
    },
    searchInput: {
        flex: 1,
        fontSize: fontSize.sm,
        paddingVertical: 0,
    },
    historyList: {
        flex: 1,
    },
    historyListContent: {
        paddingBottom: spacing.xl,
    },
    group: {
        marginBottom: spacing.md,
    },
    groupTitle: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1,
        marginBottom: spacing.sm,
        textTransform: 'uppercase',
    },
    historyCard: {
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        marginBottom: spacing.sm,
    },
    historyCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        marginBottom: spacing.xs,
    },
    historyTitle: {
        flex: 1,
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    historyPreview: {
        fontSize: fontSize.sm,
        lineHeight: 20,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.xl,
        gap: spacing.sm,
    },
    emptyTitle: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    emptyText: {
        fontSize: fontSize.sm,
        textAlign: 'center',
        lineHeight: 20,
        maxWidth: 240,
    },
});

export default ChatHistoryDrawer;
