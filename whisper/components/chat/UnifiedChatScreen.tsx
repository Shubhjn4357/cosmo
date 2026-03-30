/**
 * Unified Chat Screen - Master Component
 * Combines all features from index.tsx for consistent use across the app
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    FlatList,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    Image,
    Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

// Types
import { Message } from '@/types';

// Hooks
import { useChat, useFilePicker, useNetworkStatus, useAuth, useSmartMode, useSwipeToReload, useUnifiedTokens, useVoiceInput } from '@/hooks';

// Components
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { SkeletonBubble } from './SkeletonBubble';
import { BottomSheet } from '@/components/BottomSheet';
import { GeminiSidebar } from '@/components/GeminiSidebar';
import { AvatarStatusBadge } from '@/components/AvatarStatusBadge';
import { InteractiveButton } from '@/components/InteractiveButton';
import { getAvatarSource } from '@/assets/stock/avatars';
import { useToast } from '@/components/Toast';
import { CharacterSelector } from '@/components/CharacterSelector';
import llmBackend from '@/services/llmBackend';
import { generateVisionFromText } from '@/services/visionGeneration';
import { SubscriptionDrawer } from '@/components/Drawer/SubscriptionDrawer';
import { DataFeedDrawer } from '@/components/Drawer/DataFeedDrawer';
import { SupportPopup } from '@/components/SupportPopup';
import { UpgradeDrawer } from '@/components/UpgradeDrawer';
import { notificationService } from '@/services/notificationService';

export interface UnifiedChatScreenProps {
    mode?: 'chat' | 'roleplay';
    character?: any; // RoleplayCharacter
    characterId?: string;
    characterName?: string;
    characterAvatar?: string;
    systemPrompt?: string;
    onBack?: () => void;
    onMenu?: () => void;
    initialMessages?: any[];
    onMessageSent?: (message: any) => void;
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
    const { profile, isAuthenticated } = useAuth();
    const { tokenInfo, checkTokens, getTokenCost, isGuest } = useUnifiedTokens();
    const { isRecording, isTranscribing, startRecording, stopRecording, transcribe, cancelRecording } = useVoiceInput();
    const toast = useToast();

    // Construct active character object from props
    const activeCharacterProp = character || (characterId ? {
        id: characterId,
        name: characterName,
        avatar: characterAvatar,
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
        createImageMode,
        isGeneratingImage,
        setInputText,
        cycleModel,
        setCreateImageMode,
        sendMessage,
        stopGeneration,
        loadHistory,
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

    const { isConnected, isServerReachable, isChecking } = useNetworkStatus();
    const [useRag, setUseRag] = useState(false);
    const [enterToSend, setEnterToSend] = useState(true);
    const [showSidebar, setShowSidebar] = useState(false);
    const [showBottomSheet, setShowBottomSheet] = useState(false);
    const [showCharacterSelector, setShowCharacterSelector] = useState(false);

    // Character state
    const [selectedCharacter, setSelectedCharacter] = useState<any | null>(activeCharacterProp);
    const [characterMessages, setCharacterMessages] = useState<any[]>(initialMessages || []);
    const [characterLoading, setCharacterLoading] = useState(false);

    const [showSubscriptionDrawer, setShowSubscriptionDrawer] = useState(false);
    const [showDataFeedDrawer, setShowDataFeedDrawer] = useState(false);
    const [showSupportPopup, setShowSupportPopup] = useState(false);
    const [showUpgradeDrawer, setShowUpgradeDrawer] = useState(false);
    const [upgradeFeature, setUpgradeFeature] = useState('');

    // Sync props with state
    useEffect(() => {
        if (activeCharacterProp) {
            setSelectedCharacter(activeCharacterProp);
        }
    }, [characterId, characterName]); // Re-run if props change

    useEffect(() => {
        if (initialMessages) {
            setCharacterMessages(initialMessages);
        }
    }, [initialMessages]);

    // Swipe to reload
    const { refreshing, onRefresh } = useSwipeToReload(async () => {
        // Refresh logic
    });
    const flatListRef = useRef<FlatList>(null);

    // Load settings
    useEffect(() => {
        AsyncStorage.getItem('enter_to_send').then(val => {
            if (val !== null) setEnterToSend(val === 'true');
        });

        // Request notification permissions
        if (mode === 'chat') {
            (async () => {
                await notificationService.requestPermissions();
                const isPro = profile?.subscription_tier === 'pro';
                const isFirstLaunch = await notificationService.isFirstLaunch();
                if (!isPro && isFirstLaunch) {
                    setTimeout(() => setShowSupportPopup(true), 3000);
                }
            })();
        }
    }, [profile, mode]);

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

    // Render message
    const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => (
        <MessageBubble
            message={item}
            isNew={index === (selectedCharacter ? characterMessages : messages).length - 1}
            onGenerateVision={handleGenerateVision}
        />
    ), [messages.length, characterMessages.length, selectedCharacter, handleGenerateVision]);

    const bottomSheetOptions = [
        { icon: 'sparkles', label: 'Create image', color: '#8B5CF6', onPress: () => setCreateImageMode(true) },
        { icon: 'camera', label: 'Camera', color: '#10B981', onPress: () => pickFromCamera() },
        { icon: 'images', label: 'Gallery', color: '#3B82F6', onPress: () => pickFromGallery() },
        { icon: 'document', label: 'Upload file', color: '#F59E0B', onPress: () => pickFile(['*/*']) },
    ];

    const isPro = profile?.subscription_tier === 'pro';

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

                        {selectedCharacter && mode === 'roleplay' ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                {characterAvatar && <Image source={{ uri: characterAvatar }} style={{ width: 30, height: 30, borderRadius: 15 }} />}
                                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                                    {characterName || selectedCharacter.name}
                                </Text>
                            </View>
                        ) : (
                            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Whisper</Text>
                        )}
                    </View>

                    <View style={styles.headerRight}>
                        {/* Token Counter */}
                        {tokenInfo && (
                            <TouchableOpacity
                                onPress={() => {
                                    if (isGuest) setShowUpgradeDrawer(true);
                                    else router.push('/subscription');
                                }}
                                style={[styles.tokenBadge, {
                                    backgroundColor: tokenInfo.isLow ? theme.colors.error + '20' : theme.colors.primary + '20',
                                    borderColor: tokenInfo.isLow ? theme.colors.error : theme.colors.primary,
                                }]}
                            >
                                <Ionicons name="flash" size={14} color={tokenInfo.isLow ? theme.colors.error : theme.colors.primary} />
                                <Text style={[styles.tokenText, { color: tokenInfo.isLow ? theme.colors.error : theme.colors.primary }]}>
                                    {tokenInfo.tokensRemaining}
                                </Text>
                            </TouchableOpacity>
                        )}

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

                                {/* Character Selector */}
                                <InteractiveButton onPress={() => setShowCharacterSelector(true)} style={styles.headerButton}>
                                    <Ionicons name="person-outline" size={20} color={theme.colors.textMuted} />
                                </InteractiveButton>

                                {/* New Chat */}
                                <InteractiveButton onPress={startNewChat} style={styles.headerButton}>
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
                                <Text style={{ fontWeight: '700' }}>Whisper Flash</Text>
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
                                    { emoji: '🎓', label: 'Help me learn' },
                                ].map((action, idx) => (
                                    <TouchableOpacity
                                        key={idx}
                                        style={[styles.actionPill, { backgroundColor: theme.colors.surface }]}
                                        onPress={() => {
                                            if (action.label === 'Create image') setCreateImageMode(true);
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
                        data={selectedCharacter ? characterMessages : messages}
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
                            (isLoading || isGeneratingImage || characterLoading || isStreaming) ? (
                                <View style={{ marginBottom: spacing.md }}>
                                    {progressStatus && <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginLeft: spacing.sm }}>{progressStatus}</Text>}
                                    <SkeletonBubble />
                                </View>
                            ) : null
                        }
                    />

                    <ChatInput
                        inputText={inputText}
                        isLoading={isLoading || isGeneratingImage || characterLoading}
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
                            } catch (error: any) {
                                toast.error('Voice Error', error.message || 'Failed');
                                await cancelRecording();
                            }
                        }}
                        onSend={async () => {
                            const cost = getTokenCost('chat');
                            const hasTokens = await checkTokens(cost);
                            if (!hasTokens) {
                                setUpgradeFeature('Out of tokens!');
                                setShowUpgradeDrawer(true);
                                return;
                            }

                            if (selectedCharacter && inputText.trim() && !selectedFile) {
                                const currentInput = inputText;
                                setInputText('');
                                setCharacterLoading(true);

                                try {
                                    // Set backend based on selection
                                    if (useModel === 'local') {
                                        await llmBackend.setCurrentBackend('local');
                                    } else if (useModel === 'self-learner') {
                                        await llmBackend.setCurrentBackend('self_learner');
                                    } else if (useModel === 'cloud') {
                                        await llmBackend.setCurrentBackend('gemini');
                                    } else {
                                        await llmBackend.setCurrentBackend('Whisper_server');
                                    }

                                    const characterPrompt = `You are ${selectedCharacter.name}. ${selectedCharacter.description || ''}\\n\\nStay in character.`;
                                    const history = characterMessages.slice(-10).map((m: any) => ({
                                        role: (m.isUser ? 'user' : 'assistant') as 'user' | 'assistant',
                                        content: m.text
                                    }));

                                    const response = await llmBackend.completionWithFallback({
                                        messages: [...history, { role: 'user', content: currentInput }],
                                        systemPrompt: characterPrompt,
                                        temperature: 0.85,
                                        maxTokens: 512,
                                    });

                                    const timestamp = Date.now();
                                    const userMsg = { id: `msg-${timestamp}`, text: currentInput, isUser: true, timestamp: new Date() };
                                    const aiMsg = { id: `msg-${timestamp + 1}`, text: response.content, isUser: false, timestamp: new Date(), character: selectedCharacter };

                                    setCharacterMessages(prev => [
                                        ...prev,
                                        userMsg,
                                        aiMsg
                                    ]);

                                    if (onMessageSent) {
                                        onMessageSent(userMsg);
                                        onMessageSent(aiMsg);
                                    }
                                } catch (error) {
                                    toast.error('Error', 'Failed to get response');
                                } finally {
                                    setCharacterLoading(false);
                                }
                            } else {
                                sendMessage(selectedFile);
                                setSelectedFile(null);
                            }
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

            <GeminiSidebar
                visible={showSidebar}
                onClose={() => setShowSidebar(false)}
                histories={chatHistories}
                onSelectHistory={(h) => { loadHistory(h); setShowSidebar(false); }}
                onNewChat={() => { startNewChat(); setShowSidebar(false); }}
            />

            <CharacterSelector
                visible={showCharacterSelector}
                onClose={() => setShowCharacterSelector(false)}
                onSelect={(character) => setSelectedCharacter(character)}
                selectedCharacter={selectedCharacter}
            />

            <SubscriptionDrawer
                visible={showSubscriptionDrawer}
                onClose={() => setShowSubscriptionDrawer(false)}
                onSubscribe={() => setShowSubscriptionDrawer(false)}
            />

            <DataFeedDrawer
                visible={showDataFeedDrawer}
                onClose={() => setShowDataFeedDrawer(false)}
            />

            <SupportPopup
                visible={showSupportPopup}
                onClose={() => setShowSupportPopup(false)}
                onUpgrade={() => { setShowSupportPopup(false); setShowSubscriptionDrawer(true); }}
            />

            <UpgradeDrawer
                visible={showUpgradeDrawer}
                onClose={() => setShowUpgradeDrawer(false)}
                onUpgrade={() => { setShowUpgradeDrawer(false); setShowSubscriptionDrawer(true); }}
                feature={upgradeFeature}
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
    tokenBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.full, borderWidth: 1, gap: 4 },
    tokenText: { fontSize: 12, fontWeight: '700' },
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
