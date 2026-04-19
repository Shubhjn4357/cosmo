/**
 * Unified Chat Screen - Master Component
 * Combines all features from index.tsx for consistent use across the app
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    FlatList,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

// Types
import { Message, RoleplayCharacter, RawMessage, IconName, CharacterAction } from '@/types';

// Hooks
import {
    useAppPreferences,
    useChat,
    useFilePicker,
    useNetworkStatus,
    useAuth,
    useSwipeToReload,
    useVoiceInput,
} from '@/hooks';

// Components
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { SkeletonBubble } from './SkeletonBubble';
import { BottomSheet } from '@/components/BottomSheet';
import { CosmoSidebar } from '@/components/CosmoSidebar';
import { AvatarStatusBadge } from '@/components/AvatarStatusBadge';
import { InteractiveButton } from '@/components/InteractiveButton';
import { getAvatarSource } from '@/assets/stock/avatars';
import { useToast } from '@/components/Toast';
import { CharacterSelector } from '@/components/CharacterSelector';
import { generateVisionFromText } from '@/services/visionGeneration';
import { DataFeedDrawer } from '@/components/Drawer/DataFeedDrawer';
import { notificationService } from '@/services/notificationService';
import { characterService } from '@/services/characterService';
import { ChatHistoryDrawer } from '@/components/chat/ChatHistoryDrawer';

export interface UnifiedChatScreenProps {
    mode?: 'chat' | 'roleplay';
    character?: RoleplayCharacter;
    characterId?: string;
    characterName?: string;
    characterAvatar?: string;
    systemPrompt?: string;
    onBack?: () => void;
    onMenu?: () => void;
    initialMessages?: RawMessage[];
    onMessageSent?: (message: Message) => void;
}

function normalizeSeedMessages(messages?: RawMessage[]): Message[] {
    return (messages || []).map((message, index) => ({
        id: String(message?.id ?? `seed-${Date.now()}-${index}`),
        text: String(message?.text ?? message?.content ?? ''),
        imageUri: message?.imageUri ?? message?.image_url,
        isUser: Boolean(message?.isUser ?? message?.role === 'user'),
        timestamp: message?.timestamp ? new Date(message.timestamp) : new Date(),
    }));
}

function buildCharacterPrompt(character: RoleplayCharacter | null, systemPrompt?: string) {
    if (!character && !systemPrompt) return systemPrompt || '';

    const promptParts = [
        systemPrompt,
        character?.systemPrompt,
        character?.personality ? `Personality: ${character.personality}` : '',
        character?.description ? `Character details: ${character.description}` : '',
        character?.tags?.length ? `Traits: ${character.tags.join(', ')}` : '',
        character?.name ? `You are ${character.name}. Stay consistent, conversational, and in character.` : '',
    ].filter(Boolean);

    return promptParts.join('\n\n').trim();
}

function resolveCharacterGreeting(character: RoleplayCharacter | null) {
    return character?.greeting?.trim?.() || '';
}

function isAdultCharacter(character: RoleplayCharacter | null) {
    return Boolean(character?.nsfw || character?.isNSFW);
}

function resolveCharacterAvatar(character: RoleplayCharacter | null, fallbackAvatar?: string) {
    if (character?.avatar) {
        if (typeof character.avatar === 'string' && character.avatar.startsWith('local://')) {
            return characterService.getAvatarSource(character as any);
        }
        if (typeof character.avatar === 'string' && character.avatar.startsWith('http')) {
            return { uri: character.avatar };
        }
    }

    if (fallbackAvatar) {
        return { uri: fallbackAvatar };
    }

    return null;
}

export function UnifiedChatScreen({
    mode = 'chat',
    character,
    characterId,
    characterName,
    characterAvatar,
    systemPrompt,
    onBack,
    onMenu,
    initialMessages,
    onMessageSent,
}: UnifiedChatScreenProps) {
    const { theme } = useTheme();
    const router = useRouter();
    const { profile } = useAuth();
    const { enterToSend, nsfwEnabled, setNsfwEnabled } = useAppPreferences();
    const { isRecording, isTranscribing, startRecording, stopRecording, transcribe, cancelRecording } = useVoiceInput();
    const toast = useToast();

    // Construct active character object from props
    const activeCharacterProp: RoleplayCharacter | null = character || (characterId ? {
        id: characterId,
        name: characterName || 'AI',
        avatar: characterAvatar,
        description: '',
        personality: '',
        tags: [],
        systemPrompt: systemPrompt
    } : null);

    // Custom hooks from index.tsx logic
    const {
        messages,
        inputText,
        isLoading,
        isStreaming,
        progressStatus,
        chatHistories,
        useModel,
        useRag,
        createImageMode,
        isGeneratingImage,
        setInputText,
        cycleModel,
        setCreateImageMode,
        setUseRag,
        sendMessage,
        stopGeneration,
        loadHistory,
        deleteHistory,
        hydrateMessages,
        startNewChat,
    } = useChat();

    const {
        selectedFile,
        showFileModal,
        fileTypeOptions,
        setShowFileModal,
        setSelectedFile,
        pickFile,
        pickFromCamera,
        pickFromGallery,
        formatFileSize,
    } = useFilePicker();

    const { isConnected, isServerReachable } = useNetworkStatus();
    const [showSidebar, setShowSidebar] = useState(false);
    const [showBottomSheet, setShowBottomSheet] = useState(false);
    const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
    const [showCharacterSelector, setShowCharacterSelector] = useState(false);

    // Character state
    const [selectedCharacter, setSelectedCharacter] = useState<RoleplayCharacter | null>(activeCharacterProp);

    const [showDataFeedDrawer, setShowDataFeedDrawer] = useState(false);
    const seededConversationKeyRef = useRef<string | null>(null);

    // Sync props with state and handle NSFW auto-enable
    useEffect(() => {
        if (activeCharacterProp && activeCharacterProp.id !== selectedCharacter?.id) {
            setSelectedCharacter(activeCharacterProp);
        }
        
        if (selectedCharacter && isAdultCharacter(selectedCharacter) && !nsfwEnabled) {
            void setNsfwEnabled(true);
        }
    }, [activeCharacterProp, selectedCharacter, nsfwEnabled, setNsfwEnabled]);

    useEffect(() => {
        if (messages.length > 0) {
            return;
        }

        const selectedKey = selectedCharacter?.id || (mode === 'roleplay' ? 'roleplay-default' : 'chat-default');
        const initialSeed = normalizeSeedMessages(initialMessages);
        if (initialSeed.length > 0 && seededConversationKeyRef.current !== `${selectedKey}:initial`) {
            hydrateMessages(initialSeed);
            seededConversationKeyRef.current = `${selectedKey}:initial`;
            return;
        }

        const greeting = resolveCharacterGreeting(selectedCharacter);
        if (selectedCharacter && greeting && seededConversationKeyRef.current !== `${selectedKey}:greeting`) {
            hydrateMessages([
                {
                    id: `greeting-${selectedKey}`,
                    text: greeting,
                    isUser: false,
                    timestamp: new Date(),
                },
            ]);
            seededConversationKeyRef.current = `${selectedKey}:greeting`;
        }
    }, [hydrateMessages, initialMessages, messages.length, mode, selectedCharacter]);

    // Swipe to reload
    const { refreshing, onRefresh } = useSwipeToReload(async () => {
        // Refresh logic
    });
    const flatListRef = useRef<FlatList>(null);

    useEffect(() => {
        if (mode === 'chat') {
            (async () => {
                await notificationService.requestPermissions();
            })();
        }
    }, [mode, profile]);

    // Vision generation handler
    const handleGenerateVision = useCallback(async (prompt: string) => {
        try {
            const imageUrl = await generateVisionFromText(prompt);
            return imageUrl;
        } catch (error) {
            console.error('Vision generation failed:', error);
            throw error;
        }
    }, []);

    const characterPrompt = useMemo(
        () => buildCharacterPrompt(selectedCharacter, systemPrompt),
        [selectedCharacter, systemPrompt]
    );

    const characterAvatarSource = useMemo(
        () => resolveCharacterAvatar(selectedCharacter, characterAvatar),
        [selectedCharacter, characterAvatar]
    );

    const isRoleplayActive = Boolean(selectedCharacter) || mode === 'roleplay';
    const effectiveNsfwMode = nsfwEnabled || isAdultCharacter(selectedCharacter);

    // Render message
    const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => (
        <MessageBubble
            message={item}
            isNew={index === messages.length - 1}
            onGenerateVision={handleGenerateVision}
        />
    ), [messages.length, handleGenerateVision]);

    const bottomSheetOptions = [
        { icon: 'sparkles', label: 'Create image', color: '#8B5CF6', onPress: () => setCreateImageMode(true) },
        { icon: 'camera', label: 'Camera', color: '#10B981', onPress: () => pickFromCamera() },
        { icon: 'images', label: 'Gallery', color: '#3B82F6', onPress: () => pickFromGallery() },
        { icon: 'document', label: 'Upload file', color: '#F59E0B', onPress: () => pickFile(['*/*']) },
    ];

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                {/* Header */}
                <View style={[styles.header, { backgroundColor: theme.colors.background }]}>
                    <View style={styles.headerLeft}>
                        {onBack ? (
                            <TouchableOpacity onPress={onBack} style={styles.headerButton}>
                                <Ionicons name="arrow-back" size={26} color={theme.colors.text} />
                            </TouchableOpacity>
                        ) : (
                            <InteractiveButton
                                onPress={() => setShowSidebar(true)}
                                tooltip="Main Menu"
                                style={styles.headerButton}
                            >
                                <Ionicons name="menu" size={26} color={theme.colors.text} />
                            </InteractiveButton>
                        )}

                        {selectedCharacter ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                {characterAvatarSource && <Image source={characterAvatarSource} style={{ width: 30, height: 30, borderRadius: 15 }} />}
                                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                                    {characterName || selectedCharacter.name}
                                </Text>
                            </View>
                        ) : (
                            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Cosmo</Text>
                        )}
                    </View>

                    <View style={styles.headerRight}>
                        {onMenu && (
                            <TouchableOpacity onPress={onMenu} style={styles.headerButton}>
                                <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.text} />
                            </TouchableOpacity>
                        )}

                        {!onMenu && mode === 'chat' && (
                            <>
                                {/* RAG/Web Search */}
                                <InteractiveButton
                                    onPress={() => setUseRag(!useRag)}
                                    style={[styles.headerButton, {
                                        backgroundColor: useRag ? theme.colors.primary + '20' : 'transparent',
                                        borderRadius: borderRadius.full,
                                        borderWidth: 1,
                                        borderColor: useRag ? theme.colors.primary : theme.colors.textMuted + '40',
                                    }]}
                                >
                                    <Ionicons name={useRag ? "globe" : "globe-outline"} size={20} color={useRag ? theme.colors.primary : theme.colors.textMuted} />
                                </InteractiveButton>

                                <InteractiveButton
                                    onPress={() => setShowHistoryDrawer(true)}
                                    style={styles.headerButton}
                                >
                                    <Ionicons name="time-outline" size={20} color={theme.colors.textMuted} />
                                </InteractiveButton>

                                {/* Character Selector */}
                                <InteractiveButton onPress={() => setShowCharacterSelector(true)} style={styles.headerButton}>
                                    <Ionicons name="person-outline" size={20} color={theme.colors.textMuted} />
                                </InteractiveButton>

                                <InteractiveButton
                                    onPress={() => {
                                        void setNsfwEnabled(!nsfwEnabled);
                                    }}
                                    style={[styles.headerButton, {
                                        backgroundColor: effectiveNsfwMode ? theme.colors.error + '18' : 'transparent',
                                        borderRadius: borderRadius.full,
                                        borderWidth: 1,
                                        borderColor: effectiveNsfwMode ? theme.colors.error : theme.colors.textMuted + '40',
                                    }]}
                                >
                                    <Text style={{ color: effectiveNsfwMode ? theme.colors.error : theme.colors.textMuted, fontSize: 12, fontWeight: '700' }}>
                                        18+
                                    </Text>
                                </InteractiveButton>

                                {/* New Chat */}
                                <InteractiveButton
                                    onPress={() => {
                                        seededConversationKeyRef.current = null;
                                        startNewChat();
                                    }}
                                    style={styles.headerButton}
                                >
                                    <Ionicons name="add-circle-outline" size={24} color={theme.colors.primary} />
                                </InteractiveButton>

                                {/* Avatar */}
                                <InteractiveButton onPress={() => router.push('/profile/edit')} style={styles.avatarButton}>
                                    <AvatarStatusBadge status={(isConnected && isServerReachable) ? 'online' : 'offline'}>
                                        {profile?.avatar_url ? (
                                            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
                                        ) : (
                                            <View style={[styles.avatar, { backgroundColor: theme.colors.surface }]}>
                                                <Ionicons name="person" size={18} color={theme.colors.textMuted} />
                                            </View>
                                        )}
                                    </AvatarStatusBadge>
                                </InteractiveButton>
                            </>
                        )}
                    </View>
                </View>

                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
                >
                    {/* Welcome Container (Only for Main Chat and Empty) */}
                    {mode === 'chat' && messages.length === 0 && !selectedCharacter && (
                        <View style={styles.welcomeContainer}>
                            <Text style={[styles.greeting, { color: theme.colors.text }]}>
                                Hi {profile?.display_name || 'there'}
                            </Text>
                            <Text style={[styles.promoText, { color: theme.colors.text }]}>
                                Try our latest Fast model,{'\n'}
                                <Text style={{ fontWeight: '400' }}>now powered by </Text>
                                <Text style={{ fontWeight: '700' }}>Cosmo Flash</Text>
                            </Text>

                            <View style={styles.suggestionsContainer}>
                                {['Break down different health supplements', 'Map out a 3-month plan to learn French'].map((s, idx) => (
                                    <TouchableOpacity key={idx} style={styles.suggestionRow} onPress={() => setInputText(s)}>
                                        <View style={[styles.purpleBullet, { backgroundColor: theme.colors.primary }]} />
                                        <Text style={[styles.suggestionText, { color: theme.colors.text }]}>{s}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <View style={styles.actionPillsContainer}>
                                {[
                                    { emoji: '🎨', label: 'Create image' },
                                    { emoji: '📄', label: 'Write anything' },
                                    { emoji: '🧠', label: 'Cosmo Agent' },
                                    { emoji: '🎓', label: 'Help me learn' },
                                ].map((action: CharacterAction, idx) => (
                                    <TouchableOpacity
                                        key={idx}
                                        style={[styles.actionPill, { backgroundColor: theme.colors.surface }]}
                                        onPress={() => {
                                            if (action.label === 'Create image') setCreateImageMode(true);
                                            else if (action.label === 'Cosmo Agent') setInputText('/agent ');
                                            else setInputText(action.label + ': ');
                                        }}
                                    >
                                        <Text style={styles.actionEmoji}>{action.emoji}</Text>
                                        <Text style={[styles.actionLabel, { color: theme.colors.text }]}>{action.label}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}

                    {/* Messages */}
                    <FlatList
                        ref={flatListRef}
                        data={messages}
                        renderItem={renderMessage}
                        keyExtractor={item => item.id}
                        contentContainerStyle={[styles.messageList, { paddingBottom: 100 }]}
                        style={styles.flatList}
                        showsVerticalScrollIndicator={true}
                        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        ListFooterComponent={
                            (isLoading || isGeneratingImage || isStreaming) ? (
                                <View style={{ marginBottom: spacing.md }}>
                                    {progressStatus && <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginLeft: spacing.sm }}>{progressStatus}</Text>}
                                    <SkeletonBubble />
                                </View>
                            ) : null
                        }
                    />

                    <ChatInput
                        inputText={inputText}
                        isLoading={isLoading || isGeneratingImage}
                        isStreaming={isStreaming}
                        onStopGeneration={stopGeneration}
                        useModel={useModel}
                        selectedFile={selectedFile}
                        enterToSend={enterToSend}
                        onChangeText={setInputText}
                        isRecording={isRecording}
                        isTranscribing={isTranscribing}
                        onVoiceInput={async () => {
                            try {
                                if (isRecording) {
                                    const audioUri = await stopRecording();
                                    if (audioUri) {
                                        const text = await transcribe(audioUri);
                                        setInputText(inputText + (inputText ? ' ' : '') + text);
                                        toast.success('Transcribed', 'Voice input added');
                                    }
                                } else {
                                    await startRecording();
                                    toast.info('Recording', 'Tap mic again to stop');
                                }
                            } catch (error) {
                                        const errorMessage = error instanceof Error ? error.message : 'Unknown voice error';
                                        toast.error('Voice Error', errorMessage);
                                        await cancelRecording();
                                    }
                                }}
                                onSend={async () => {
                                    await sendMessage({
                                        file: selectedFile,
                                        systemPrompt: characterPrompt,
                                        roleplayMode: isRoleplayActive,
                                        nsfwMode: effectiveNsfwMode,
                                    });
                                    setSelectedFile(null);
                                }}
                        onModelSwitch={() => {
                            void cycleModel();
                        }}
                        onFilePick={() => setShowBottomSheet(true)}
                        pickFromCamera={() => pickFromCamera()}
                        onFileRemove={() => setSelectedFile(null)}
                        formatFileSize={formatFileSize}
                        createImageMode={createImageMode}
                        setCreateImageMode={setCreateImageMode}
                    />
                </KeyboardAvoidingView>

                {/* Modals and Drawers */}
                <BottomSheet
                    visible={showBottomSheet}
                    onClose={() => setShowBottomSheet(false)}
                    options={bottomSheetOptions}
                    title="Add to chat"
                />
            </SafeAreaView>

            <CosmoSidebar
                visible={showSidebar}
                onClose={() => setShowSidebar(false)}
                histories={chatHistories}
                onSelectHistory={(h) => { loadHistory(h); setShowSidebar(false); }}
                onNewChat={() => { startNewChat(); setShowSidebar(false); }}
                onDeleteHistory={(historyId) => {
                    void deleteHistory(historyId);
                }}
            />

            <ChatHistoryDrawer
                visible={showHistoryDrawer}
                onClose={() => setShowHistoryDrawer(false)}
                histories={chatHistories}
                onSelectHistory={(history) => {
                    loadHistory(history);
                    setShowHistoryDrawer(false);
                }}
                onDeleteHistory={(historyId) => {
                    void deleteHistory(historyId);
                }}
                onNewChat={() => {
                    seededConversationKeyRef.current = null;
                    startNewChat();
                    setShowHistoryDrawer(false);
                }}
            />

            <CharacterSelector
                visible={showCharacterSelector}
                onClose={() => setShowCharacterSelector(false)}
                onSelect={(character) => {
                    if (character?.id !== selectedCharacter?.id) {
                        seededConversationKeyRef.current = null;
                        startNewChat();
                    }
                    setSelectedCharacter(character);
                    if (character && isAdultCharacter(character) && !nsfwEnabled) {
                        void setNsfwEnabled(true);
                    }
                }}
                selectedCharacter={selectedCharacter}
            />

            <DataFeedDrawer
                visible={showDataFeedDrawer}
                onClose={() => setShowDataFeedDrawer(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    headerButton: { padding: spacing.xs },
    headerTitle: { fontSize: fontSize.xl, fontWeight: '700' },
    avatarButton: { marginLeft: spacing.xs },
    avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    welcomeContainer: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md, flex: 1 },
    greeting: { fontSize: 18, fontWeight: '400', marginBottom: spacing.xs },
    promoText: { fontSize: 26, fontWeight: '500', lineHeight: 34, marginBottom: spacing.xl },
    suggestionsContainer: { marginBottom: spacing.xl, gap: spacing.md },
    suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    purpleBullet: { width: 10, height: 10, borderRadius: 5 },
    suggestionText: { fontSize: fontSize.md, flex: 1 },
    actionPillsContainer: { gap: spacing.sm },
    actionPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 20, gap: spacing.sm },
    actionEmoji: { fontSize: 16 },
    actionLabel: { fontSize: fontSize.sm, fontWeight: '500' },
    messageList: { flexDirection: 'column', justifyContent: 'flex-start', paddingHorizontal: spacing.md, paddingTop: spacing.md },
    flatList: { flex: 1 },
});
