/**
 * Cosmo AI - useChat Hook
 * Handles chat logic, history persistence, image intents, and runtime routing.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Animated, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { storage } from '@/utils/storage';

import { Message, ChatHistory, ModelType } from '@/types';
import { cosmoAPI, ChatResponse } from '@/services/api';
import agentMode from '@/services/agentMode';
import LLMBackendService from '@/services/llmBackend';
import { imageToBase64 } from '@/services/camera';
import { useAuth } from './useAuth';
import { useUnifiedTokens } from './useUnifiedTokens';
import { usePersonality } from './usePersonality';
import { useAIRuntime } from './useAIRuntime';

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
const DEFAULT_IMAGE_MODEL_ID = 'cyberrealistic-v9';
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

function isImageAttachment(file: { name?: string; type?: string } | null | undefined) {
    if (!file) return false;
    const mimeType = String(file.type || '').toLowerCase();
    if (mimeType.startsWith('image/')) return true;
    return /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(file.name || ''));
}

function shouldRunAgent(prompt: string) {
    const normalized = prompt.trim().toLowerCase();
    return /^\/(agent|task)\b/.test(normalized)
        || /^agent:\s*/.test(normalized)
        || /^Cosmo agent[:,]?\s*/.test(normalized);
}

function extractAgentPrompt(prompt: string) {
    const trimmed = prompt.trim();

    if (/^\/agent\b/i.test(trimmed)) return trimmed.replace(/^\/agent\b\s*/i, '').trim();
    if (/^\/task\b/i.test(trimmed)) return trimmed.replace(/^\/task\b\s*/i, '').trim();
    if (/^agent:\s*/i.test(trimmed)) return trimmed.replace(/^agent:\s*/i, '').trim();
    if (/^Cosmo agent[:,]?\s*/i.test(trimmed)) return trimmed.replace(/^Cosmo agent[:,]?\s*/i, '').trim();

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

function describeAgentProgress(task: {
    status: string;
    plan?: { tool: string; status: string }[];
    toolResults?: { tool: string; summary?: string }[];
}) {
    const runningStep = task.plan?.find((step) => step.status === 'running');
    if (runningStep) {
        return `Cosmo Agent is running ${runningStep.tool.replace(/_/g, ' ')}...`;
    }

    if (task.status === 'queued') return 'Cosmo Agent is queued...';
    if (task.status === 'cancelling') return 'Cosmo Agent is cancelling...';
    if (task.status === 'cancelled') return 'Cosmo Agent task cancelled.';
    if (task.status === 'failed') return 'Cosmo Agent failed.';
    if (task.status === 'completed') return 'Cosmo Agent completed.';

    const lastTool = task.toolResults?.[task.toolResults.length - 1];
    if (lastTool?.tool) {
        return `Cosmo Agent finished ${lastTool.tool.replace(/_/g, ' ')}...`;
    }

    return 'Cosmo Agent is working...';
}

async function buildKnowledgeContext(query: string) {
    const normalized = query.trim();
    if (!normalized) return '';

    try {
        const results = await CosmoAPI.searchKnowledge(normalized, 5);
        if (!results.length) return '';

        const snippets = results.slice(0, 4).map((result, index) => (
            `[${index + 1}] ${result.text}\nSource: ${result.source}`
        ));

        return `Knowledge context:\n${snippets.join('\n\n')}`;
    } catch (error) {
        console.error('Knowledge lookup failed:', error);
        return '';
    }
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
    const agentSessionIdRef = useRef<string | null>(null);

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
            await storage.setItem(STORAGE_KEY, histories);
        } catch (error) {
            console.error('Failed to persist local histories:', error);
        }
    }, []);

    const loadHistories = useCallback(async () => {
        try {
            let loadedHistories: ChatHistory[] = [];

            if (user?.id) {
                const { success, histories } = await CosmoAPI.getChatHistories(user.id);
                if (success) {
                    loadedHistories = histories.map(normalizeHistory);
                }
            } else {
                const stored = await storage.getItem<ChatHistory[]>(STORAGE_KEY);
                if (stored) {
                    loadedHistories = stored.map(normalizeHistory);
                }
            }

            setChatHistories(dedupeHistories(loadedHistories));
        } catch (error) {
            console.error('Failed to load chat histories:', error);
            try {
                const stored = await storage.getItem<string>(STORAGE_KEY);
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
        agentSessionIdRef.current = null;
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
                    await CosmoAPI.updateChatHistory(resolvedChatId, {
                        title,
                        messages: payloadMessages,
                    });
                } else {
                    const response = await CosmoAPI.createChatHistory(user.id, title, payloadMessages);
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
            const response = await CosmoAPI.generateImage({
                prompt: normalizedPrompt,
                negativePrompt: DEFAULT_IMAGE_NEGATIVE_PROMPT,
                modelId,
                width: 768,
                height: 768,
                numSteps: 18,
                guidanceScale: 6.5,
                isLocal: true,
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

    const runAgentTask = useCallback(async (params: {
        prompt: string;
        userMessage: Message;
        history: { role: 'user' | 'assistant'; content: string }[];
        conversationContext: string;
        effectiveSystemPrompt: string;
        options: SendMessageOptions;
    }): Promise<{ text: string; imageUri?: string; metadata?: Message['metadata'] }> => {
        setProgressStatus('Cosmo Agent is planning...');

        let task = await agentMode.startTask({
            message: params.prompt,
            history: params.history,
            sessionId: agentSessionIdRef.current || undefined,
            context: params.conversationContext,
            systemPrompt: params.effectiveSystemPrompt,
            useRAG: useRag,
            nsfwMode: params.options.nsfwMode,
            roleplayMode: params.options.roleplayMode,
            modelMode: useModel,
            allowResearch: true,
            allowImages: true,
            maxSteps: 4,
            maxTokens: 384,
            userId: user?.id,
        });

        agentSessionIdRef.current = task.sessionId;
        setProgressStatus(describeAgentProgress(task));

        while (!agentMode.isTerminalStatus(task.status)) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            task = await agentMode.refreshTask(task.sessionId);
            agentSessionIdRef.current = task.sessionId;
            setProgressStatus(describeAgentProgress(task));
        }
        agentSessionIdRef.current = null;

        if (task.status === 'cancelled') {
            return {
                text: task.answer || 'Cosmo Agent task was cancelled.',
                imageUri: task.imageUrl || undefined,
                metadata: {
                    model: `agent:${task.backend}`,
                    agentSessionId: task.sessionId,
                    agentBackend: task.backend,
                    agentTools: task.toolResults.map((item) => item.tool),
                    agentPlan: task.plan,
                    citations: task.citations,
                },
            };
        }

        if (task.status === 'failed') {
            const failureText = task.answer
                || task.toolResults[task.toolResults.length - 1]?.summary
                || 'Cosmo Agent failed before it could finish the task.';
            return {
                text: failureText,
                imageUri: task.imageUrl || undefined,
                metadata: {
                    model: `agent:${task.backend}`,
                    agentSessionId: task.sessionId,
                    agentBackend: task.backend,
                    agentTools: task.toolResults.map((item) => item.tool),
                    agentPlan: task.plan,
                    citations: task.citations,
                },
            };
        }

        setProgressStatus(task.imageUrl ? 'Cosmo Agent completed with an image.' : 'Cosmo Agent completed.');

        return {
            text: task.answer || 'Cosmo Agent completed, but no final answer was returned.',
            imageUri: task.imageUrl || undefined,
            metadata: {
                model: `agent:${task.backend}`,
                agentSessionId: task.sessionId,
                agentBackend: task.backend,
                agentTools: task.toolResults.map((item) => item.tool),
                agentPlan: task.plan,
                citations: task.citations,
            },
        };
    }, [useModel, useRag, user?.id]);

    const sendMessage = useCallback(async (options: SendMessageOptions = {}) => {
        const selectedFile = options.file ?? null;
        const trimmedInput = inputText.trim();
        const isAgentRequest = !selectedFile && shouldRunAgent(trimmedInput);
        const agentPrompt = isAgentRequest ? extractAgentPrompt(trimmedInput) : '';
        const autoImageIntent = !selectedFile && !isAgentRequest && shouldAutoGenerateImage(trimmedInput);
        const selectedFileIsImage = isImageAttachment(selectedFile);
        const selfLearnerUnifiedImageRequest = useModel === 'self-learner' && (createImageMode || autoImageIntent);

        if (createImageMode && !selfLearnerUnifiedImageRequest) {
            await generateImage(trimmedInput, false, DEFAULT_IMAGE_MODEL_ID);
            setInputText('');
            return;
        }

        if ((!trimmedInput && !selectedFile) || isLoading) return;

        if (isAgentRequest && !agentPrompt) {
            setMessages((previous) => [
                ...previous,
                {
                    id: `msg-${Date.now()}`,
                    text: 'Cosmo Agent needs a task. Example: /agent research the best local model setup for this app.',
                    isUser: false,
                    timestamp: new Date(),
                },
            ]);
            return;
        }

        if (autoImageIntent && useModel !== 'self-learner') {
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
            text: trimmedInput || (selectedFile
                ? (selectedFileIsImage && useModel === 'self-learner'
                    ? `Describe and learn this image: ${selectedFile.name}`
                    : `Analyze file: ${selectedFile.name}`)
                : ''),
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
            const effectiveSystemPrompt = options.roleplayMode && options.systemPrompt
                ? [
                    baseSystemPrompt,
                    'Roleplay character instructions override the default assistant personality when they conflict.',
                    options.systemPrompt,
                ].filter(Boolean).join('\n\n').trim()
                : [baseSystemPrompt, options.systemPrompt].filter(Boolean).join('\n\n').trim();

            const effectivePrompt = isAgentRequest ? agentPrompt : userMessage.text;

            const externalKnowledgeContext = useRag && (useModel === 'cloud' || useModel === 'local')
                ? await buildKnowledgeContext(effectivePrompt)
                : '';

            const conversationContext = [options.context, externalKnowledgeContext, buildConversationContext(messages)]
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

            let responseText = '';
            let responseImageUri: string | undefined;
            let responseMetadata: Message['metadata'] | undefined;

            if (selectedFile) {
                if (useModel === 'self-learner' && selectedFileIsImage) {
                    try {
                        const base64 = await imageToBase64(selectedFile.uri);
                        if (!base64) {
                            throw new Error('Could not read the selected image.');
                        }

                        const response = await CosmoAPI.chatSelfLearner({
                            message: trimmedInput || 'Describe this image, learn it, and use it in future multimodal reasoning.',
                            history,
                            context: conversationContext,
                            useRAG: useRag,
                            systemPrompt: effectiveSystemPrompt,
                            maxTokens: 320,
                            temperature: options.roleplayMode ? 0.85 : 0.7,
                            nsfwMode: options.nsfwMode,
                            roleplayMode: options.roleplayMode,
                            imageDataUrl: `data:${selectedFile.type || 'image/jpeg'};base64,${base64}`,
                            ...getApiParams(),
                        });
                        responseText = response.response;
                        responseImageUri = response.image_url;
                        responseMetadata = {
                            model: response.image_url ? 'self-learner-multimodal' : 'self-learner',
                        };
                    } catch (fileError) {
                        console.error('Self-learner image analysis failed:', fileError);
                        responseText = 'Sorry, I had trouble analyzing that image with the self-learner runtime.';
                    }
                } else {
                    try {
                        const question = [
                            trimmedInput || 'Summarize this document and tell me what it contains.',
                            effectiveSystemPrompt ? `Use this response style:\n${effectiveSystemPrompt}` : '',
                        ].filter(Boolean).join('\n\n');
                        const response = await CosmoAPI.analyzeFile(
                            { uri: selectedFile.uri, name: selectedFile.name, type: selectedFile.type },
                            question
                        );
                        responseText = response.answer || 'I could not analyze this file. Please try again.';
                    } catch (fileError) {
                        console.error('File analysis failed:', fileError);
                        responseText = 'Sorry, I had trouble analyzing that file. Please make sure the file is readable and try again.';
                    }
                }
            } else if (isAgentRequest) {
                const agentResponse = await runAgentTask({
                    prompt: agentPrompt,
                    userMessage,
                    history,
                    conversationContext,
                    effectiveSystemPrompt,
                    options,
                });
                responseText = agentResponse.text;
                responseImageUri = agentResponse.imageUri;
                responseMetadata = agentResponse.metadata;
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
                        const response = await CosmoAPI.chatSelfLearner({
                            message: selfLearnerUnifiedImageRequest ? extractImagePrompt(userMessage.text) : userMessage.text,
                            history,
                            context: conversationContext,
                            useRAG: useRag,
                            systemPrompt: effectiveSystemPrompt,
                            maxTokens: 320,
                            temperature: options.roleplayMode ? 0.85 : 0.7,
                            nsfwMode: options.nsfwMode,
                            roleplayMode: options.roleplayMode,
                            generateImage: selfLearnerUnifiedImageRequest,
                            ...getApiParams(),
                        });
                        responseText = response.response;
                        responseImageUri = response.image_url;
                        responseMetadata = {
                            model: response.image_url ? 'self-learner-multimodal' : 'self-learner',
                        };
                    } else {
                        if (useModel === 'local') {
                            await LLMBackendService.setCurrentBackend('local');
                        } else if (useModel === 'cloud') {
                            await LLMBackendService.setCurrentBackend('gemini');
                        } else {
                            await LLMBackendService.setCurrentBackend('Cosmo_server');
                        }

                        const stream = LLMBackendService.stream({
                            messages: [
                                ...history,
                                { role: 'user' as const, content: userMessage.text },
                            ],
                            systemPrompt: streamSystemPrompt,
                            useRag,
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
                        const response: ChatResponse = await CosmoAPI.chat({
                            message: userMessage.text,
                            useRAG: useRag,
                            context: conversationContext,
                            systemPrompt: effectiveSystemPrompt,
                            history,
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
                imageUri: responseImageUri,
                isUser: false,
                timestamp: new Date(),
                metadata: responseMetadata,
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
        runAgentTask,
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
        agentSessionIdRef.current = null;
    }, []);

    const deleteHistory = useCallback(async (historyId: string) => {
        try {
            if (user?.id && !historyId.startsWith('local-')) {
                await cosmoAPI.deleteChatHistory(historyId);
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
        agentSessionIdRef.current = null;
        setStreamingMessage('');
        setProgressStatus('');
    }, [messages, saveToHistory]);

    const stopGeneration = useCallback(() => {
        const currentAbortController = abortControllerRef.current;
        const currentAgentSessionId = agentSessionIdRef.current;

        if (currentAbortController) {
            currentAbortController.abort();
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
            return;
        }

        if (currentAgentSessionId) {
            setProgressStatus('Cancelling Cosmo Agent...');
            void agentMode.cancelTask(currentAgentSessionId)
                .catch((error) => {
                    console.error('Failed to cancel agent session:', error);
                })
                .finally(() => {
                    setIsLoading(false);
                    setProgressStatus('');
                });
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
