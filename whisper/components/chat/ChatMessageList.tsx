/**
 * Chat Message List - Reusable message list component
 * Handles FlatList rendering with guaranteed unique keys
 */

import React, { useRef, useEffect } from 'react';
import { FlatList, View, StyleSheet, Image, Text } from 'react-native';
import { MessageBubble } from '@/components/chat';
import { useTheme, spacing, borderRadius } from '@/constants/theme';
import { UnifiedMessage } from '@/hooks/useUnifiedChat';

export interface ChatMessageListProps {
    messages: UnifiedMessage[];
    isTyping?: boolean;
    characterAvatar?: string;
    characterName?: string;
    onGenerateVision?: (prompt: string) => Promise<string>;
    refreshing?: boolean;
    onRefresh?: () => void;
}

export function ChatMessageList({
    messages,
    isTyping = false,
    characterAvatar,
    characterName,
    onGenerateVision,
    refreshing = false,
    onRefresh,
}: ChatMessageListProps) {
    const { theme } = useTheme();
    const flatListRef = useRef<FlatList>(null);
    
    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (messages.length > 0) {
            setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
            }, 100);
        }
    }, [messages.length]);
    
    // Render individual message
    const renderMessage = ({ item }: { item: UnifiedMessage }) => {
        const isUser = item.role === 'user';
        
        return (
            <View
                style={[
                    styles.messageContainer,
                    isUser ? styles.userMessageContainer : styles.aiMessageContainer,
                ]}
            >
                {/* Character avatar for assistant messages */}
                {!isUser && characterAvatar && (
                    <Image
                        source={{ uri: characterAvatar }}
                        style={styles.messageAvatar}
                    />
                )}
                
                {/* Message bubble */}
                <View
                    style={[
                        styles.messageBubble,
                        isUser
                            ? [styles.userBubble, { backgroundColor: theme.colors.primary }]
                            : [styles.aiBubble, { backgroundColor: theme.colors.surface }],
                    ]}
                >
                    <Text
                        style={[
                            styles.messageText,
                            { color: isUser ? '#fff' : theme.colors.text },
                        ]}
                    >
                        {item.content}
                    </Text>
                </View>
            </View>
        );
    };
    
    // Typing indicator component
    const TypingIndicator = () => (
        <View style={[styles.typingIndicator, { backgroundColor: theme.colors.surface }]}>
            {characterAvatar && (
                <Image
                    source={{ uri: characterAvatar }}
                    style={styles.typingAvatar}
                />
            )}
            <View style={styles.typingDots}>
                <View style={[styles.dot, { backgroundColor: theme.colors.textMuted }]} />
                <View style={[styles.dot, { backgroundColor: theme.colors.textMuted }]} />
                <View style={[styles.dot, { backgroundColor: theme.colors.textMuted }]} />
            </View>
        </View>
    );
    
    return (
        <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id} // Guaranteed unique from useUnifiedChat
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
            refreshing={refreshing}
            onRefresh={onRefresh}
            ListFooterComponent={isTyping ? <TypingIndicator /> : null}
        />
    );
}

const styles = StyleSheet.create({
    messagesList: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        paddingBottom: 120,
    },
    messageContainer: {
        flexDirection: 'row',
        marginVertical: spacing.xs,
    },
    userMessageContainer: {
        justifyContent: 'flex-end',
    },
    aiMessageContainer: {
        justifyContent: 'flex-start',
    },
    messageAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        marginRight: spacing.xs,
    },
    messageBubble: {
        maxWidth: '75%',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.lg,
    },
    userBubble: {
        borderBottomRightRadius: 4,
    },
    aiBubble: {
        borderBottomLeftRadius: 4,
    },
    messageText: {
        fontSize: 16,
        lineHeight: 22,
    },
    typingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        borderRadius: borderRadius.lg,
        alignSelf: 'flex-start',
    },
    typingAvatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
        marginRight: spacing.sm,
    },
    typingDots: {
        flexDirection: 'row',
        gap: 4,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
});
