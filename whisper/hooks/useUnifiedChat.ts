/**
 * Unified Chat Hook - Shared logic for both regular chat and roleplay
 * Handles message state, LLM backend integration, and unique ID generation
 */

import { useState, useCallback, useRef } from 'react';
import llmBackend from '@/services/llmBackend';
import { useToast } from '@/components/Toast';

// Message counter for guaranteed unique IDs
let messageIdCounter = 0;

const generateMessageId = () => {
    messageIdCounter++;
    return `msg-${Date.now()}-${messageIdCounter}`;
};

export interface UnifiedMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    imageUrl?: string;
    characterId?: string;
}

export interface UseUnifiedChatOptions {
    mode: 'chat' | 'roleplay';
    systemPrompt?: string;
    characterId?: string;
    onMessageAdded?: (message: UnifiedMessage) => void;
}

export interface UseUnifiedChatReturn {
    messages: UnifiedMessage[];
    inputText: string;
    isTyping: boolean;
    isLoading: boolean;
    
    setInputText: (text: string) => void;
    sendMessage: () => Promise<void>;
    addUserMessage: (content: string) => UnifiedMessage;
    addAssistantMessage: (content: string) => UnifiedMessage;
    clearMessages: () => void;
    
    // Model management
    initializeModel: () => Promise<void>;
}

export function useUnifiedChat(options: UseUnifiedChatOptions): UseUnifiedChatReturn {
    const { mode, systemPrompt, characterId, onMessageAdded } = options;
    const toast = useToast();
    
    const [messages, setMessages] = useState<UnifiedMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const isInitialized = useRef(false);
    
    /**
     * Initialize local model if using local backend
     */
    const initializeModel = useCallback(async () => {
        if (isInitialized.current) return;
        
        try {
            const currentBackend = llmBackend.getCurrentBackendType();
            if (currentBackend === 'local') {
                console.log('🔄 Initializing local model...');
                await llmBackend.initializeBackend('local');
                console.log('✅ Local model ready');
                isInitialized.current = true;
            }
        } catch (error) {
            console.warn('Model initialization:', error);
            // Model might already be initialized, continue
        }
    }, []);
    
    /**
     * Add user message to chat
     */
    const addUserMessage = useCallback((content: string): UnifiedMessage => {
        const message: UnifiedMessage = {
            id: generateMessageId(),
            role: 'user',
            content,
            timestamp: new Date(),
            characterId,
        };
        
        setMessages(prev => [...prev, message]);
        onMessageAdded?.(message);
        return message;
    }, [characterId, onMessageAdded]);
    
    /**
     * Add assistant message to chat
     */
    const addAssistantMessage = useCallback((content: string): UnifiedMessage => {
        const message: UnifiedMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content,
            timestamp: new Date(),
            characterId,
        };
        
        setMessages(prev => [...prev, message]);
        onMessageAdded?.(message);
        return message;
    }, [characterId, onMessageAdded]);
    
    /**
     * Send message to LLM
     */
    const sendMessage = useCallback(async () => {
        if (!inputText.trim() || isLoading) return;
        
        const userContent = inputText.trim();
        setInputText('');
        
        // Add user message
        addUserMessage(userContent);
        
        // Show typing indicator
        setIsTyping(true);
        setIsLoading(true);
        
        try {
            // Ensure model is initialized
            await initializeModel();
            
            // Prepare message history
            const chatMessages = messages.slice(-10).map(m => ({
                role: m.role as 'user' | 'assistant' | 'system',
                content: m.content,
            }));
            
            // Add current user message
            chatMessages.push({
                role: 'user',
                content: userContent,
            });
            
            // Call LLM backend
            const response = await llmBackend.completionWithFallback({
                messages: chatMessages,
                systemPrompt: systemPrompt || 'You are a helpful AI assistant.',
                temperature: mode === 'roleplay' ? 0.85 : 0.7,
                maxTokens: 512,
            });
            
            // Add assistant response
            addAssistantMessage(response.content);
            
        } catch (error) {
            console.error(`${mode} chat error:`, error);
            toast.error('Error', 'Failed to get response');
            
            // Add error message
            addAssistantMessage(
                `Sorry, I couldn't process that. ${error instanceof Error ? error.message : 'Please try again.'}`
            );
        } finally {
            setIsTyping(false);
            setIsLoading(false);
        }
    }, [inputText, isLoading, messages, systemPrompt, mode, addUserMessage, addAssistantMessage, initializeModel, toast]);
    
    /**
     * Clear all messages
     */
    const clearMessages = useCallback(() => {
        setMessages([]);
    }, []);
    
    return {
        messages,
        inputText,
        isTyping,
        isLoading,
        
        setInputText,
        sendMessage,
        addUserMessage,
        addAssistantMessage,
        clearMessages,
        
        initializeModel,
    };
}

export default useUnifiedChat;
