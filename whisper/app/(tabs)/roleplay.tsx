/**
 * Whisper AI - Roleplay Screen
 * Character selection and roleplay chat interface
 */

import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Image,
    FlatList,
    ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { 
    roleplayService, 
    CharacterPersonality, 
    RoleplayMessage, 
    RoleplaySession 
} from '@/services/roleplayService';
import llmBackend from '@/services/llmBackend';
import { useToast } from '@/components/Toast'
import { generateVisionFromText } from '@/services/visionGeneration';
import { useDialog } from '@/components/Dialog';
import { UnifiedChatScreen } from '@/components/chat/UnifiedChatScreen';

type ViewMode = 'characters' | 'chat';

// Allow guest users - they have 5 free tokens via use Guest hook
export default function RoleplayScreen() {
    const { theme, isDark } = useTheme();
    const toast = useToast();
    const dialog = useDialog();
    const flatListRef = useRef<FlatList>(null);
    
    // State
    const [viewMode, setViewMode] = useState<ViewMode>('characters');
    const [characters, setCharacters] = useState<CharacterPersonality[]>([]);
    const [filteredCharacters, setFilteredCharacters] = useState<CharacterPersonality[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [selectedCharacter, setSelectedCharacter] = useState<CharacterPersonality | null>(null);
    const [currentSession, setCurrentSession] = useState<RoleplaySession | null>(null);
    const [messages, setMessages] = useState<RoleplayMessage[]>([]);
    
    // Chat state
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [nsfw18Plus, setNsfw18Plus] = useState(true); // Allow NSFW by default

    // Load characters and 18+ mode on mount
    useEffect(() => {
        const init = async () => {
            // Load 18+ mode preference
            const nsfwMode = await AsyncStorage.getItem('nsfw18Plus');
            if (nsfwMode !== null) setNsfw18Plus(nsfwMode === 'true');

            loadCharacters();
        };
        init();
    }, []);
    
    // Filter characters when category or 18+ mode changes
    useEffect(() => {
        let filtered = characters;

        // Filter by category
        if (selectedCategory !== 'all') {
            filtered = filtered.filter(c => c.category === selectedCategory);
        }

        // Filter NSFW if 18+ mode is off
        if (!nsfw18Plus) {
            filtered = filtered.filter(c => !c.isNSFW);
        }

        setFilteredCharacters(filtered);
    }, [selectedCategory, characters, nsfw18Plus]);

    const loadCharacters = async () => {
        const chars = roleplayService.getCharacters();
        setCharacters(chars);
        setFilteredCharacters(chars); // Initially show all
    };
    
    /**
     * Start a chat session with a character
     */
    const startSession = async (character: CharacterPersonality) => {
        setIsLoading(true);
        try {
            const session = await roleplayService.startSession(character.id);
            setCurrentSession(session);
            setSelectedCharacter(character);
            setMessages(session.messages);
            setViewMode('chat');
        } catch (error) {
            toast.error('Error', 'Failed to start session');
        } finally {
            setIsLoading(false);
        }
    };
    
    /**
     * Send a message in the current session
     */
    /**
     * Send a message in the current session
     */
    const sendMessage = async () => {
        if (!inputText.trim() || !currentSession || !selectedCharacter) return;
        
        const userMessage = inputText.trim();
        setInputText('');
        
        // Add user message immediately
        const userMsg = await roleplayService.addMessage(userMessage, 'user');
        if (userMsg) {
            setMessages(prev => [...prev, userMsg]);
        }
        
        // Scroll to bottom
        setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
        
        // Generate AI response
        setIsTyping(true);
        try {
            // IMPORTANT: Ensure local model is initialized if using local backend
            const currentBackend = llmBackend.getCurrentBackendType();
            if (currentBackend === 'local') {
                try {
                    await llmBackend.initializeBackend('local');
                } catch (initError) {
                    console.warn('Model initialization check:', initError);
                    // Model might already be initialized, continue
                }
            }

            // Build context with memories
            const context = roleplayService.buildContext();
            
            // Map RoleplayMessage to ChatMessage
            const messages = context.messages.map(m => ({
                role: m.role as 'user' | 'assistant' | 'system',
                content: m.content
            }));

            // Use LLMBackend with fallback
            const response = await llmBackend.completionWithFallback({
                messages,
                systemPrompt: context.systemPrompt,
                temperature: 0.85,
                maxTokens: 512,
            });
            
            // Add AI response
            const aiMsg = await roleplayService.addMessage(response.content, 'assistant');
            if (aiMsg) {
                setMessages(prev => [...prev, aiMsg]);
            }
            
        } catch (error) {
            console.error('Roleplay chat error:', error);
            toast.error('Error', 'Failed to get response');
        } finally {
            setIsTyping(false);
            setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
            }, 100);
        }
    };
    
    /**
     * Go back to character selection
     */
    const goBack = () => {
        setViewMode('characters');
        setSelectedCharacter(null);
        setCurrentSession(null);
        setMessages([]);
    };

    /**
     * Handle vision generation from message
     */
    const handleGenerateVision = async (messageContent: string) => {
        try {
            const imageUrl = await generateVisionFromText(messageContent);
            if (imageUrl) {
                // Add image as a new message
                const imageMsg = await roleplayService.addMessage(imageUrl, 'assistant');
                if (imageMsg) {
                    setMessages(prev => [...prev, imageMsg]);
                }
                toast.success('Image Generated', 'Vision generated successfully');
            }
        } catch (error) {
            toast.error('Error', 'Failed to generate vision');
        }
    };

    /**
     * Get category color
     */
    const getCategoryColor = (category: string) => {
        const colors: Record<string, string> = {
            romantic: '#ff6b6b',
            companion: '#4ecdc4',
            adventure: '#ffe66d',
            fantasy: '#a55eea',
            assistant: '#45b7d1',
            custom: '#95a5a6',
        };
        return colors[category] || '#95a5a6';
    };
    
    /**
     * Render character card
     */
    const renderCharacterCard = ({ item }: { item: CharacterPersonality }) => (
        <TouchableOpacity
            style={[styles.characterCard, { backgroundColor: theme.colors.surface }]}
            onPress={() => startSession(item)}
            disabled={isLoading}
        >
            <Image 
                source={{ uri: item.avatar }} 
                style={styles.characterAvatar}
            />
            <View style={styles.characterInfo}>
                <Text style={[styles.characterName, { color: theme.colors.text }]}>
                    {item.name}
                </Text>
                <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(item.category) + '30' }]}>
                    <Text style={[styles.categoryText, { color: getCategoryColor(item.category) }]}>
                        {item.category}
                    </Text>
                </View>
                <Text 
                    style={[styles.characterDesc, { color: theme.colors.textSecondary }]}
                    numberOfLines={2}
                >
                    {item.description}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
    );
    
    /**
     * Render chat message
     */
    const renderMessage = ({ item }: { item: RoleplayMessage }) => {
        const isUser = item.role === 'user';
        
        return (
            <TouchableOpacity
                onLongPress={() => !isUser && handleGenerateVision(item.content)}
                style={[
                    styles.messageContainer,
                    isUser ? styles.userMessageContainer : styles.aiMessageContainer
                ]}
            >
                {!isUser && selectedCharacter && (
                    <Image 
                        source={{ uri: selectedCharacter.avatar }} 
                        style={styles.messageAvatar}
                    />
                )}
                <View style={[
                    styles.messageBubble,
                    isUser 
                        ? [styles.userBubble, { backgroundColor: theme.colors.primary }]
                        : [styles.aiBubble, { backgroundColor: theme.colors.surface }]
                ]}>
                    <Text style={[
                        styles.messageText,
                        { color: isUser ? '#fff' : theme.colors.text }
                    ]}>
                        {item.content}
                    </Text>
                </View>
            </TouchableOpacity>
        );
    };
    
    // Character selection view
    if (viewMode === 'characters') {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        💭 Roleplay
                    </Text>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        Chat with AI personalities that remember you
                    </Text>
                </View>
                
                {/* Categories */}
                <View style={styles.categoriesContainer}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.categoriesContent}
                    >
                        {['all', 'romantic', 'companion', 'fantasy', 'adventure', 'assistant', 'naughty'].map((cat) => (
                        <TouchableOpacity
                            key={cat}
                            style={[
                                styles.categoryChip,
                                { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder },
                                selectedCategory === cat && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '20' }
                            ]}
                                onPress={() => setSelectedCategory(cat)}
                        >
                            <Text style={[styles.categoryChipText, { color: theme.colors.text }]}>
                                {cat === 'all' ? '✨ All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                    </ScrollView>
                </View>
                
                {/* Character List */}
                <FlatList
                    data={filteredCharacters}
                    renderItem={renderCharacterCard}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.characterList}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <View style={{ padding: spacing.lg, alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textSecondary }}>
                                No characters in this category
                            </Text>
                        </View>
                    }
                />
            </SafeAreaView>
        );
    }
    

    // Chat view - Use UnifiedChatScreen
    return (
        <UnifiedChatScreen
            mode="roleplay"
            initialMessages={messages}
            onMessageSent={(msg) => {
                if (selectedCharacter) {
                    roleplayService.addMessage(selectedCharacter.id, msg.text, msg.isUser);
                }
            }}
            characterId={selectedCharacter?.id}
            characterName={selectedCharacter?.name}
            characterAvatar={selectedCharacter?.avatar}
            systemPrompt={selectedCharacter?.systemPrompt}
            onBack={goBack}
            onMenu={() => {
                dialog.options({
                    title: selectedCharacter?.name || 'Menu',
                    message: 'What would you like to do?',
                    options: [
                        {
                            text: 'Character Info',
                            onPress: () => {
                                dialog.alert({
                                    title: selectedCharacter?.name || '',
                                    message: selectedCharacter?.description || '',
                                    icon: 'information-circle',
                                });
                            },
                        },
                        {
                            text: 'Export Chat',
                            onPress: () => toast.info('Export', 'Chat export feature in development'),
                        },
                        {
                            text: 'Clear Chat',
                            style: 'destructive',
                            onPress: () => {
                                dialog.confirm({
                                    title: 'Clear Chat',
                                    message: 'Delete all messages in this conversation?',
                                    icon: 'trash-outline',
                                    confirmText: 'Clear',
                                    confirmStyle: 'destructive',
                                    onConfirm: () => {
                                        toast.success('Cleared', 'Chat history cleared');
                                    },
                                });
                            },
                        },
                    ],
                });
            }}
        />
    );

}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        padding: spacing.lg,
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    subtitle: {
        fontSize: fontSize.md,
        marginTop: spacing.xs,
    },
    categoriesContainer: {
        paddingVertical: spacing.md,
    },
    categoriesContent: {
        paddingHorizontal: spacing.lg,
        gap: spacing.sm,
    },
    categoryChip: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.full,
        borderWidth: 1,
    },
    categoryChipText: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    characterList: {
        padding: spacing.lg,
        gap: spacing.md,
    },
    characterCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        marginBottom: spacing.md,
    },
    characterAvatar: {
        width: 60,
        height: 60,
        borderRadius: 30,
    },
    characterInfo: {
        flex: 1,
        marginLeft: spacing.md,
    },
    characterName: {
        fontSize: fontSize.lg,
        fontWeight: '600',
    },
    categoryBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: borderRadius.sm,
        marginTop: 4,
    },
    categoryText: {
        fontSize: fontSize.xs,
        fontWeight: '600',
        textTransform: 'capitalize',
    },
    characterDesc: {
        fontSize: fontSize.sm,
        marginTop: spacing.xs,
    },
    // Chat styles
    chatContainer: {
        flex: 1,
    },
    chatHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: spacing.xs,
    },
    chatHeaderInfo: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: spacing.sm,
    },
    headerAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    headerName: {
        fontSize: fontSize.md,
        fontWeight: '600',
        marginLeft: spacing.sm,
    },
    headerStatus: {
        fontSize: fontSize.xs,
        marginLeft: spacing.sm,
    },
    menuButton: {
        padding: spacing.xs,
    },
    messagesList: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        paddingBottom: 120, // Extra padding for input area
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
        fontSize: fontSize.md,
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
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.sm,
        borderTopWidth: 1,
    },
    attachButton: {
        padding: spacing.xs,
    },
    textInput: {
        flex: 1,
        minHeight: 40,
        maxHeight: 100,
        marginHorizontal: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.lg,
        fontSize: fontSize.md,
    },
    sendButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
