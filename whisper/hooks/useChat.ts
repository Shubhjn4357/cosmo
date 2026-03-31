/**
 * Whisper App - useChat Hook
 * Handles chat logic, history persistence, image intents, and runtime routing.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Animated, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Message, ChatHistory, ModelType } from '@/types';
import { whisperAPI, ChatResponse } from '@/services/api';
import LLMBackendService from '@/services/llmBackend';
import { useAuth } from './useAuth';
import { useUnifiedTokens } from './useUnifiedTokens';
import { usePersonality } from './usePersonality';
import { useAIRuntime } from './useAIRuntime';
import { smartModeAPI } from '@/services/smartModeAPI';

interface UseChatOptions {
    useRag?: boolean;
}

export interface SendMessageOptions {
    file?: { uri: string; name: string; type?: string; size?: number } | null;
    systemPrompt?: string;
    roleplayMode?: boolean;
    nsfwMode?: boolean;
    context?: string;
}

interface UseChatReturn {
    messages: Message[];
    inputText: string;
    isLoading: boolean;
    isStreaming: boolean;
    streamingMessage: string;
    progressStatus: string;
    chatHistories: ChatHistory[];
    useModel: ModelType;
    modelSwitchEnabled: boolean;
    createImageMode: boolean;
    isGeneratingImage: boolean;
    useRag: boolean;
    setInputText: (text: string) => void;
    setUseModel: (model: ModelType) => void;
    cycleModel: () => Promise<ModelType>;
    setCreateImageMode: (mode: boolean) => void;
    setUseRag: (enabled: boolean) => void;
    sendMessage: (options?: SendMessageOptions) => Promise<void>;
    stopGeneration: () => void;
    generateImage: (prompt: string, useLocal?: boolean, modelId?: string) => Promise<void>;
    saveToHistory: (historyMessages?: Message[]) => Promise<void>;
    loadHistory: (history: ChatHistory) => void;
    deleteHistory: (historyId: string) => Promise<void>;
    hydrateMessages: (nextMessages: Message[], chatId?: string | null) => void;
    startNewChat: () => void;
    fadeAnim: Animated.Value;
}

const STORAGE_KEY = 'chatHistories';
const DEFAULT_IMAGE_MODEL_ID = 'flux-schnell';
const DEFAULT_IMAGE_NEGATIVE_PROMPT = 'blurry, bad quality, distorted, ugly, low resolution, watermark, text, signature';

function truncate(text: string, maxLength: number) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trim()}…`;
}

function normalizeTimestamp(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
}

function normalizeMessage(raw: any): Message {
    return {
        id: String(raw?.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        text: String(raw?.text ?? raw?.content ?? ''),
        imageUri: raw?.imageUri ?? raw?.image_url,
        isUser: Boolean(raw?.isUser ?? raw?.role === 'user'),
        timestamp: normalizeTimestamp(raw?.timestamp),
        file: raw?.file,
        metadata: raw?.metadata,
    };
}

function normalizeHistory(raw: any): ChatHistory {
    const messages = Array.isArray(raw?.messages) ? raw.messages.map(normalizeMessage) : [];
    return {
        id: String(raw?.id ?? `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        title: String(raw?.title ?? buildHistoryTitle(messages)),
        messages,
        createdAt: normalizeTimestamp(raw?.createdAt ?? raw?.created_at ?? messages[0]?.timestamp),
    };
}

function serializeMessages(messages: Message[]) {
    return messages.map((message) => ({
        role: message.isUser ? 'user' : 'assistant',
        content: message.text,
        timestamp: normalizeTimestamp(message.timestamp).toISOString(),
    }));
}

function buildHistoryTitle(historyMessages: Message[]) {
    const firstUserMessage = historyMessages.find((message) => message.isUser && message.text.trim());
    if (firstUserMessage) return truncate(firstUserMessage.text.trim().replace(/\s+/g, ' '), 60);
    const fallback = historyMessages.find((message) => message.text.trim());
    return truncate(fallback?.text.trim().replace(/\s+/g, ' ') || 'Chat', 60);
}

function historySignature(history: ChatHistory) {
    const firstUser = history.messages.find((message) => message.isUser)?.text.trim().toLowerCase() || '';
    const firstAssistant = history.messages.find((message) => !message.isUser)?.text.trim().toLowerCase() || '';
    return `${firstUser.slice(0, 80)}::${firstAssistant.slice(0, 80)}::${history.messages.length}`;
}

function dedupeHistories(histories: ChatHistory[]) {
    const sorted = [...histories].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const seenIds = new Set<string>();
    const seenSignatures = new Set<string>();
    const deduped: ChatHistory[] = [];

    for (const history of sorted) {
        const signature = historySignature(history);
        if (seenIds.has(history.id) || seenSignatures.has(signature)) continue;
        seenIds.add(history.id);
        seenSignatures.add(signature);
        deduped.push(history);
    }

    return deduped;
}

function shouldAutoGenerateImage(prompt: string) {
    const normalized = prompt.trim().toLowerCase();
    return /^(generate|create|make|draw|imagine|show)\s+(an?\s+)?image\b/.test(normalized)
        || /^(render|illustrate)\b/.test(normalized)
        || /^\/(image|imagine)\b/.test(normalized);
}

function extractImagePrompt(prompt: string) {
    const trimmed = prompt.trim();
    const normalized = trimmed.toLowerCase();

    if (normalized.startsWith('/image ')) return trimmed.slice(7).trim();
    if (normalized.startsWith('/imagine ')) return trimmed.slice(9).trim();

    const patterns = [
        /^(generate|create|make|draw|show)\s+(an?\s+)?image\s+(of|for)?\s*/i,
        /^(imagine|render|illustrate)\s+(an?\s+)?/i,
    ];

    for (const pattern of patterns) {
        if (pattern.test(trimmed)) {
            return trimmed.replace(pattern, '').trim();
        }
    }

    return trimmed;
}

function buildConversationContext(historyMessages: Message[]) {
    const textOnlyMessages = historyMessages
        .filter((message) => !message.imageUri && message.text.trim())
        .slice(0, -12);

    if (textOnlyMessages.length === 0) return '';

    const summaryLines = textOnlyMessages.slice(-8).map((message) => (
        `${message.isUser ? 'User' : 'Assistant'}: ${truncate(message.text.replace(/\s+/g, ' '), 180)}`
    ));

    return `Conversation memory summary:\n${summaryLines.map((line) => `- ${line}`).join('\n')}`;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
    const { user } = useAuth();
    const { tokenInfo, checkTokens, useTokens: deductTokens, getTokenCost, getApiParams } = useUnifiedTokens();
    const { getSystemPrompt } = usePersonality();
    const { mode: useModel, setMode, cycleMode, cloudModel } = useAIRuntime();

    const [useRag, setUseRag] = useState(options.useRag ?? true);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState('');
    const [progressStatus, setProgressStatus] = useState('');
    const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
    const [createImageMode, setCreateImageMode] = useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [currentChatId, setCurrentChatId] = useState<string | null>(null);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        void loadHistories();
    }, [user?.id]);

    useEffect(() => {
        LLMBackendService.updateBackend('gemini', {
            enabled: true,
            model: cloudModel,
        }).catch((error) => {
            console.error('Failed to configure Gemini backend:', error);
        });
    }, [cloudModel]);

    const animateMessage = useCallback(() => {
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
        }).start();
    }, [fadeAnim]);

    const persistLocalHistories = useCallback(async (histories: ChatHistory[]) => {
        try {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
        } catch (error) {
            console.error('Failed to persist local histories:', error);
        }
    }, []);

    const loadHistories = useCallback(async () => {
        try {
            let loadedHistories: ChatHistory[] = [];

            if (user?.id) {
                const { success, histories } = await whisperAPI.getChatHistories(user.id);
                if (success) {
                    loadedHistories = histories.map(normalizeHistory);
                }
            } else {
                const stored = await AsyncStorage.getItem(STORAGE_KEY);
                if (stored) {
                    loadedHistories = JSON.parse(stored).map(normalizeHistory);
                }
            }

            setChatHistories(dedupeHistories(loadedHistories));
        } catch (error) {
            console.error('Failed to load chat histories:', error);
            try {
                const stored = await AsyncStorage.getItem(STORAGE_KEY);
                if (stored) {
                    setChatHistories(dedupeHistories(JSON.parse(stored).map(normalizeHistory)));
                }
            } catch (fallbackError) {
                console.error('Failed to load fallback chat histories:', fallbackError);
            }
        }
    }, [user?.id]);

    const hydrateMessages = useCallback((nextMessages: Message[], chatId?: string | null) => {
        setMessages(nextMessages.map(normalizeMessage));
        setCurrentChatId(chatId ?? null);
    }, []);

    const saveToHistory = useCallback(async (historyMessages: Message[] = messages) => {
        const normalizedMessages = historyMessages.map(normalizeMessage).filter((message) => (
            Boolean(message.text.trim()) || Boolean(message.imageUri) || Boolean(message.file)
        ));

        if (!normalizedMessages.some((message) => message.isUser)) return;

        const title = buildHistoryTitle(normalizedMessages);
        let resolvedChatId = currentChatId;

        if (user?.id) {
            try {
                const payloadMessages = serializeMessages(normalizedMessages);
                if (resolvedChatId) {
                    await whisperAPI.updateChatHistory(resolvedChatId, {
                        title,
                        messages: payloadMessages,
                    });
                } else {
                    const response = await whisperAPI.createChatHistory(user.id, title, payloadMessages);
                    if (response.success && response.id) {
                        resolvedChatId = response.id;
                        setCurrentChatId(response.id);
                    }
                }
            } catch (error) {
                console.error('Failed to sync chat history:', error);
            }
        }

        const nextHistory: ChatHistory = {
            id: resolvedChatId || `local-${Date.now()}`,
            title,
            messages: normalizedMessages,
            createdAt: normalizeTimestamp(normalizedMessages[0]?.timestamp),
        };

        setChatHistories((previous) => {
            const existing = previous.filter((history) => history.id !== nextHistory.id);
            const deduped = dedupeHistories([nextHistory, ...existing]);
            void persistLocalHistories(deduped);
            return deduped;
        });
    }, [messages, currentChatId, persistLocalHistories, user?.id]);

    const generateImage = useCallback(async (
        prompt: string,
        _useLocal: boolean = false,
        modelId: string = DEFAULT_IMAGE_MODEL_ID
    ) => {
        const normalizedPrompt = prompt.trim();
        if (!normalizedPrompt || isGeneratingImage) return;

        setIsGeneratingImage(true);

        const userMessage: Message = {
            id: `msg-${Date.now()}`,
            text: `Create image: ${normalizedPrompt}`,
            isUser: true,
            timestamp: new Date(),
        };

        setMessages((previous) => [...previous, userMessage]);
        animateMessage();

        try {
            const response = await whisperAPI.generateImage({
                prompt: normalizedPrompt,
                negativePrompt: DEFAULT_IMAGE_NEGATIVE_PROMPT,
                modelId,
                width: 768,
                height: 768,
                numSteps: 18,
                guidanceScale: 6.5,
                isLocal: false,
                ...getApiParams(),
            });

            const aiMessage: Message = {
                id: `msg-${Date.now() + 1}`,
                text: `Here is your image for: "${normalizedPrompt}"`,
                imageUri: response.image_url,
                isUser: false,
                timestamp: new Date(),
            };

            const nextMessages = [...messages, userMessage, aiMessage];
            setMessages(nextMessages);
            animateMessage();
            await saveToHistory(nextMessages);
        } catch (error) {
            console.error('Image generation error:', error);
            const errorMessage: Message = {
                id: `msg-${Date.now() + 1}`,
                text: `Sorry, I couldn't generate that image. ${error instanceof Error ? error.message : 'Please try again.'}`,
                isUser: false,
                timestamp: new Date(),
            };
            const nextMessages = [...messages, userMessage, errorMessage];
            setMessages(nextMessages);
            await saveToHistory(nextMessages);
        } finally {
            setIsGeneratingImage(false);
            setProgressStatus('');
        }
    }, [animateMessage, getApiParams, isGeneratingImage, messages, saveToHistory]);

    const safeHaptic = useCallback(async (style: Haptics.ImpactFeedbackStyle) => {
        if (Platform.OS === 'web') return;
        try {
            await Haptics.impactAsync(style);
        } catch {
            // Ignore unavailable haptics
        }
    }, []);

    const sendMessage = useCallback(async (options: SendMessageOptions = {}) => {
        const selectedFile = options.file ?? null;
        const trimmedInput = inputText.trim();

        if (createImageMode) {
            await generateImage(trimmedInput, false, DEFAULT_IMAGE_MODEL_ID);
            setInputText('');
            return;
        }

        if ((!trimmedInput && !selectedFile) || isLoading) return;

        if (!selectedFile && shouldAutoGenerateImage(trimmedInput)) {
            setInputText('');
            await generateImage(extractImagePrompt(trimmedInput), false, DEFAULT_IMAGE_MODEL_ID);
            return;
        }

        const tokenCost = useModel === 'cloud' ? getTokenCost('smart_mode') : 0;
        const hasTokens = tokenCost === 0 ? true : await checkTokens(tokenCost);
        if (!hasTokens) {
            setMessages((previous) => [
                ...previous,
                {
                    id: `msg-${Date.now()}`,
                    text: `Insufficient tokens. You need ${tokenCost} token(s) for cloud mode.`,
                    isUser: false,
                    timestamp: new Date(),
                },
            ]);
            return;
        }

        if (tokenCost > 0 && tokenInfo?.isLow) {
            setMessages((previous) => [
                ...previous,
                {
                    id: `msg-${Date.now()}`,
                    text: `Low tokens. You have ${tokenInfo.tokensRemaining} tokens remaining.`,
                    isUser: false,
                    timestamp: new Date(),
                },
            ]);
        }

        const userMessage: Message = {
            id: `msg-${Date.now()}`,
            text: trimmedInput || (selectedFile ? `Analyze file: ${selectedFile.name}` : ''),
            isUser: true,
            timestamp: new Date(),
            file: selectedFile ? { name: selectedFile.name, type: selectedFile.type, size: selectedFile.size } : undefined,
        };

        setMessages((previous) => [...previous, userMessage]);
        setInputText('');
        setIsLoading(true);
        animateMessage();
        await safeHaptic(Haptics.ImpactFeedbackStyle.Light);

        try {
            if (tokenCost > 0) {
                await deductTokens(tokenCost);
            }

            const baseSystemPrompt = getSystemPrompt();
            const effectiveSystemPrompt = [baseSystemPrompt, options.systemPrompt]
                .filter(Boolean)
                .join('\n\n')
                .trim();

            const conversationContext = [options.context, buildConversationContext(messages)]
                .filter(Boolean)
                .join('\n\n')
                .trim();

            const history = messages
                .filter((message) => !message.imageUri && message.text.trim())
                .slice(-16)
                .map((message) => ({
                    role: (message.isUser ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: message.text,
                }));

            if (useModel === 'cloud' && user?.id && !selectedFile && !options.roleplayMode && !options.nsfwMode) {
                try {
                    const response = await smartModeAPI.chat({
                        message: userMessage.text,
                        conversation_history: history.map((message) => ({
                            text: message.content,
                            isUser: message.role === 'user',
                        })),
                        user_id: user.id,
                        max_tokens: 400,
                    });

                    const aiMessage: Message = {
                        id: `msg-${Date.now() + 1}`,
                        text: response.response,
                        isUser: false,
                        timestamp: new Date(),
                        metadata: {
                            model: response.model_used,
                            responseTime: response.response_time,
                        },
                    };

                    const nextMessages = [...messages, userMessage, aiMessage];
                    setMessages(nextMessages);
                    animateMessage();
                    await saveToHistory(nextMessages);
                    return;
                } catch (smartError) {
                    console.error('Cloud mode failed over to direct runtime:', smartError);
                }
            }

            let responseText = '';

            if (selectedFile) {
                try {
                    const question = trimmedInput || 'Summarize this document and tell me what it contains.';
                    const response = await whisperAPI.analyzeFile(
                        { uri: selectedFile.uri, name: selectedFile.name, type: selectedFile.type },
                        question
                    );
                    responseText = response.answer || 'I could not analyze this file. Please try again.';
                } catch (fileError) {
                    console.error('File analysis failed:', fileError);
                    responseText = 'Sorry, I had trouble analyzing that file. Please make sure the file is readable and try again.';
                }
            } else {
                const streamSystemPrompt = [effectiveSystemPrompt, conversationContext]
                    .filter(Boolean)
                    .join('\n\n')
                    .trim();

                const abortController = new AbortController();
                abortControllerRef.current = abortController;
                setIsStreaming(true);
                setStreamingMessage('');
                setProgressStatus('Generating response...');

                try {
                    if (useModel === 'self-learner') {
                        const response = await whisperAPI.chatSelfLearner({
                            message: userMessage.text,
                            history,
                            context: conversationContext,
                            systemPrompt: effectiveSystemPrompt,
                            maxTokens: 320,
                            temperature: options.roleplayMode ? 0.85 : 0.7,
                            nsfwMode: options.nsfwMode,
                            roleplayMode: options.roleplayMode,
                            ...getApiParams(),
                        });
                        responseText = response.response;
                    } else {
                        if (useModel === 'local') {
                            await LLMBackendService.setCurrentBackend('local');
                        } else if (useModel === 'cloud') {
                            await LLMBackendService.setCurrentBackend('gemini');
                        } else {
                            await LLMBackendService.setCurrentBackend('Whisper_server');
                        }

                        const stream = LLMBackendService.stream({
                            messages: [
                                ...history,
                                { role: 'user' as const, content: userMessage.text },
                            ],
                            systemPrompt: streamSystemPrompt,
                            temperature: options.roleplayMode ? 0.85 : 0.7,
                            maxTokens: 384,
                            nsfwMode: options.nsfwMode,
                            roleplayMode: options.roleplayMode,
                        }, abortController.signal);

                        let fullResponse = '';
                        for await (const chunk of stream) {
                            fullResponse += chunk;
                            setStreamingMessage(fullResponse);
                        }
                        responseText = fullResponse;
                    }
                } catch (streamError) {
                    if (streamError instanceof Error && streamError.name === 'AbortError') {
                        return;
                    }

                    console.error('Streaming error, falling back:', streamError);

                    if (useModel === 'local') {
                        responseText = streamError instanceof Error && streamError.message
                            ? streamError.message
                            : 'Local model error. Please ensure a model is downloaded and selected in the Models tab.';
                    } else if (useModel === 'self-learner') {
                        responseText = streamError instanceof Error && streamError.message
                            ? streamError.message
                            : 'Self-learner runtime is not ready yet.';
                    } else {
                        const response: ChatResponse = await whisperAPI.chat({
                            message: userMessage.text,
                            useRAG: useRag,
                            context: conversationContext,
                            systemPrompt: effectiveSystemPrompt,
                            history,
                            smartMode: useModel === 'cloud',
                            isLocal: useModel !== 'cloud',
                            nsfwMode: options.nsfwMode,
                            roleplayMode: options.roleplayMode,
                            ...getApiParams(),
                        });
                        responseText = response.response;
                    }
                } finally {
                    setIsStreaming(false);
                    setStreamingMessage('');
                    setProgressStatus('');
                    abortControllerRef.current = null;
                }
            }

            const aiMessage: Message = {
                id: `msg-${Date.now() + 1}`,
                text: responseText,
                isUser: false,
                timestamp: new Date(),
            };

            const nextMessages = [...messages, userMessage, aiMessage];
            setMessages(nextMessages);
            animateMessage();
            await safeHaptic(Haptics.ImpactFeedbackStyle.Light);
            await saveToHistory(nextMessages);
        } catch (error) {
            console.error('Message send error:', error);
            setMessages((previous) => [
                ...previous,
                {
                    id: `msg-${Date.now() + 1}`,
                    text: error instanceof Error
                        ? error.message
                        : "Sorry, I couldn't connect. Please check if the server is running.",
                    isUser: false,
                    timestamp: new Date(),
                },
            ]);
        } finally {
            setIsLoading(false);
            setProgressStatus('');
        }
    }, [
        animateMessage,
        checkTokens,
        createImageMode,
        deductTokens,
        generateImage,
        getApiParams,
        getSystemPrompt,
        getTokenCost,
        inputText,
        isLoading,
        messages,
        safeHaptic,
        saveToHistory,
        tokenInfo?.isLow,
        tokenInfo?.tokensRemaining,
        useModel,
        useRag,
        user?.id,
    ]);

    const loadHistory = useCallback((history: ChatHistory) => {
        const normalized = normalizeHistory(history);
        setMessages(normalized.messages);
        setCurrentChatId(normalized.id);
    }, []);

    const deleteHistory = useCallback(async (historyId: string) => {
        try {
            if (user?.id && !historyId.startsWith('local-')) {
                await whisperAPI.deleteChatHistory(historyId);
            }
        } catch (error) {
            console.error('Failed to delete remote history:', error);
        } finally {
            setChatHistories((previous) => {
                const filtered = previous.filter((history) => history.id !== historyId);
                void persistLocalHistories(filtered);
                return filtered;
            });

            if (currentChatId === historyId) {
                setMessages([]);
                setCurrentChatId(null);
            }
        }
    }, [currentChatId, persistLocalHistories, user?.id]);

    const startNewChat = useCallback(() => {
        if (messages.some((message) => message.isUser)) {
            void saveToHistory(messages);
        }
        setMessages([]);
        setInputText('');
        setCurrentChatId(null);
        setStreamingMessage('');
        setProgressStatus('');
    }, [messages, saveToHistory]);

    const stopGeneration = useCallback(() => {
        if (!abortControllerRef.current) return;

        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        setIsStreaming(false);
        setIsLoading(false);

        if (streamingMessage.trim()) {
            setMessages((previous) => [
                ...previous,
                {
                    id: `msg-${Date.now()}`,
                    text: `${streamingMessage} [stopped]`,
                    isUser: false,
                    timestamp: new Date(),
                },
            ]);
            setStreamingMessage('');
        }
    }, [streamingMessage]);

    return {
        messages,
        inputText,
        isLoading,
        isStreaming,
        streamingMessage,
        progressStatus,
        chatHistories,
        useModel,
        modelSwitchEnabled: true,
        createImageMode,
        isGeneratingImage,
        useRag,
        setInputText,
        setUseModel: (model) => {
            void setMode(model);
        },
        cycleModel: cycleMode,
        setCreateImageMode,
        setUseRag,
        sendMessage,
        stopGeneration,
        generateImage,
        saveToHistory,
        loadHistory,
        deleteHistory,
        hydrateMessages,
        startNewChat,
        fadeAnim,
    };
}

export default useChat;
