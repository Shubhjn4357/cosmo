/**
 * Chat Header - Reusable header for chat and roleplay
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, fontSize, borderRadius } from '@/constants/theme';

export interface ChatHeaderProps {
    mode: 'chat' | 'roleplay';
    title?: string;
    characterAvatar?: string;
    characterName?: string;
    isTyping?: boolean;
    onBack?: () => void;
    onMenu?: () => void;
}

export function ChatHeader({
    mode,
    title,
    characterAvatar,
    characterName,
    isTyping = false,
    onBack,
    onMenu,
}: ChatHeaderProps) {
    const { theme } = useTheme();
    
    const displayTitle = title || (mode === 'chat' ? 'Cosmo' : characterName || 'Roleplay');
    const showStatus = mode === 'roleplay' && characterName;
    
    return (
        <View style={[styles.header, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.surfaceBorder }]}>
            {/* Back button (roleplay mode) */}
            {onBack && (
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                </TouchableOpacity>
            )}
            
            {/* Character info or title */}
            <View style={styles.headerInfo}>
                {characterAvatar && (
                    <Image
                        source={{ uri: characterAvatar }}
                        style={styles.headerAvatar}
                    />
                )}
                <View>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                        {displayTitle}
                    </Text>
                    {showStatus && (
                        <Text style={[styles.headerStatus, { color: isTyping ? theme.colors.primary : theme.colors.success }]}>
                            {isTyping ? 'Typing...' : 'Online'}
                        </Text>
                    )}
                </View>
            </View>
            
            {/* Menu button */}
            {onMenu && (
                <TouchableOpacity onPress={onMenu} style={styles.menuButton}>
                    <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.text} />
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: spacing.xs,
        marginRight: spacing.sm,
    },
    headerInfo: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: spacing.sm,
    },
    headerTitle: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    headerStatus: {
        fontSize: fontSize.xs,
        marginTop: 2,
    },
    menuButton: {
        padding: spacing.xs,
    },
});
