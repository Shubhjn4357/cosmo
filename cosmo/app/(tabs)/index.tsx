/**
 * Cosmo App - Main Chat Screen
 * Now uses UnifiedChatScreen for consistent features (Voice, Vision, Tokens, etc.)
 */

import React from 'react';
import { UnifiedChatScreen } from '@/components/chat/UnifiedChatScreen';

export default function ChatScreen() {
    return (
        <UnifiedChatScreen
            mode="chat"
        />
    );
}
