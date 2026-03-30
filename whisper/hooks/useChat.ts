/**
 * Whisper App - useChat Hook
 * Handles chat logic: sending messages, history, settings
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
    sendMessage: (file?: { uri: string; name: string; type?: string; size?: number } | null) => Promise<void>;
    stopGeneration: () => void;
    generateImage: (prompt: string, useLocal?: boolean) => Promise<void>;
    saveToHistory: () => void;
    loadHistory: (history: ChatHistory) => void;
    startNewChat: () => void;
    fadeAnim: Animated.Value;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
    const { user } = useAuth();
    const { tokenInfo, checkTokens, useTokens: deductTokens, getTokenCost, getApiParams } = useUnifiedTokens();
    const { getSystemPrompt } = usePersonality();
    const { mode: useModel, setMode, cycleMode, cloudModel } = useAIRuntime();
    
    // State - include welcome message
    const [useRag, setUseRag] = useState(options.useRag ?? true);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '0',
            text: "Hi! I'm Whisper AI. Ask me anything or let me help you analyze files.",
            isUser: false,
            timestamp: new Date(),
        },
    ]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState('');
    const [progressStatus, setProgressStatus] = useState(''); // Progress message
    const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
    const [modelSwitchEnabled, setModelSwitchEnabled] = useState(false);
    const [createImageMode, setCreateImageMode] = useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [currentChatId, setCurrentChatId] = useState<string | null>(null); // Track active server chat ID
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const abortControllerRef = useRef<AbortController | null>(null);

    // Load settings and history on mount
    useEffect(() => {
        loadHistories();
        // fetchSettings(); // Commented out - endpoint doesn't exist
    }, [user]); // Re-load when user changes

    useEffect(() => {
        LLMBackendService.updateBackend('gemini', {
            enabled: true,
            model: cloudModel,
        }).catch((error) => {
            console.error('Failed to configure Gemini backend:', error);
        });
    }, [cloudModel]);

    const loadHistories = async () => {
        try {
            if (user?.id) {
                // Load from server
                const { success, histories } = await whisperAPI.getChatHistories(user.id);
                if (success) {
                    setChatHistories(histories.map((h: any) => ({
                        id: h.id,
                        title: h.title,
                        messages: h.messages,
                        createdAt: new Date(h.created_at),
                    })));
                }
            } else {
                // Load from local storage
                const val = await AsyncStorage.getItem('chatHistories');
                if (val) setChatHistories(JSON.parse(val));
            }
        } catch (err) {
            // console.log('Error loading histories:', err);
            // Fallback to local on error
            const val = await AsyncStorage.getItem('chatHistories');
            if (val) setChatHistories(JSON.parse(val));
        }
    };

    // Settings endpoint doesn't exist on server - using defaults
    // const fetchSettings = async () => {
    //     try {
    //         const response = await fetch(`${API_URL}/api/settings`);
    //         const data = await response.json();
    //         setModelSwitchEnabled(data.model_switch_enabled || false);
    //     } catch (err) {
    //         console.log('Could not fetch settings');
    //     }
    // };

    // Check and load custom model on mount
    /*
    useEffect(() => {
        (async () => {
            const customModel = await modelLoader.getLoadedModel();
            if (customModel && customModel.format === 'gguf') {
                try {
                    // await localLLM.loadCustomModel();
                    // console.log('Custom .gguf model loaded successfully');
                } catch (error) {
                    console.error('Failed to load custom model:', error);
                }
            }
        })();
    }, []);
    */

    // Animation helper
    const animateMessage = useCallback(() => {
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
        }).start();
    }, [fadeAnim]);

    // Generate image - adds both prompt and result to chat
    const generateImage = useCallback(async (prompt: string, useLocal: boolean = false) => {
        if (!prompt.trim() || isGeneratingImage) return;

        setIsGeneratingImage(true);

        // Add user's image prompt to chat
        const userMessage: Message = {
            id: Date.now().toString(),
            text: `🎨 ${prompt}`,
            isUser: true,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);
        animateMessage();

        try {
            let imageUrl: string;

            if (useLocal) {
                // Local generation - would need localGen passed in
                throw new Error('Local generation requires downloading a model in Models tab');
            } else {
                const response = await whisperAPI.generateImage({
                    prompt,
                    negativePrompt: 'blurry, bad quality, distorted, ugly, low resolution, watermark, text, signature',
                    modelId: 'dreamshaper-8',
                    width: 512,
                    height: 512,
                    numSteps: 25,
                    guidanceScale: 7.5,
                    // Add token params
                    ...getApiParams(),
                });
                imageUrl = response.image_url;
            }

            // Add AI response with image to chat
            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: `Here's your image for: "${prompt}"`,
                imageUri: imageUrl,
                isUser: false,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, aiMessage]);
            animateMessage();
        } catch (error) {
            console.error('Image generation error:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: `Sorry, I couldn't generate that image. ${error instanceof Error ? error.message : 'Please try again.'}`,
                isUser: false,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsGeneratingImage(false);
            setProgressStatus('');
            // setCreateImageMode(false); // User request: keep it open? Or user removed it? I will respect user removal
        }
    }, [isGeneratingImage, animateMessage]);

    // Safe Haptic Helper
    const safeHaptic = useCallback(async (style: Haptics.ImpactFeedbackStyle) => {
        if (Platform.OS === 'web') return;
        try {
            await Haptics.impactAsync(style);
        } catch (error) {
            // Ignore unavailable haptics
        }
    }, []);

    // History management
    const saveToHistory = useCallback(async (historyMessages: Message[] = messages) => {
        if (historyMessages.length < 2) return;

        const title = historyMessages[0]?.text.slice(0, 50) || 'Chat';

        // 1. Sync with server if logged in
        if (user?.id) {
            try {
                if (currentChatId) {
                    await whisperAPI.updateChatHistory(currentChatId, {
                        messages: historyMessages.map(m => ({
                            role: m.isUser ? 'user' : 'assistant',
                            content: m.text,
                            timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
                        }))
                    });
                } else {
                    const sanitizedMessages = historyMessages.map(m => ({
                        role: m.isUser ? 'user' : 'assistant',
                        content: m.text,
                        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
                    }));
                    const { success, id } = await whisperAPI.createChatHistory(user.id, title, sanitizedMessages);
                    if (success && id) {
                        setCurrentChatId(id);
                    }
                }
            } catch (e) {
                console.error('Failed to sync chat history:', e);
            }
        }

        // 2. Save locally (fallback/cache)
        const newHistory: ChatHistory = {
            id: currentChatId || Date.now().toString(),
            title,
            messages: [...historyMessages],
            createdAt: new Date(),
        };

        // Persist local storage using the same in-memory snapshot we expose to the UI.
        setChatHistories(prev => {
            const existingIndex = prev.findIndex(h => h.id === newHistory.id);
            const updated = existingIndex >= 0
                ? prev.map((history, index) => index === existingIndex ? newHistory : history)
                : [newHistory, ...prev];
            const sorted = updated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            void AsyncStorage.setItem('chatHistories', JSON.stringify(sorted));
            return sorted;
        });

    }, [messages, user, currentChatId]);

    // Send message (optionally with a file)
    const sendMessage = useCallback(async (file?: { uri: string; name: string; type?: string; size?: number } | null) => {
        // If in create image mode, generate image instead
        if (createImageMode) {
            await generateImage(inputText, useModel === 'local');
            setInputText('');
            return;
        }

        if ((!inputText.trim() && !file) || isLoading) return;

        // Cloud mode consumes tokens. Self-hosted and local runtimes stay free.
        const tokenCost = useModel === 'cloud' ? getTokenCost('smart_mode') : 0;

        const hasTokens = tokenCost === 0 ? true : await checkTokens(tokenCost);
        if (!hasTokens) {
            // Show error and don't send
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                text: `Insufficient tokens. You need ${tokenCost} token(s) for cloud mode.`,
                isUser: false,
                timestamp: new Date(),
            }]);
            return;
        }

        // Show low token warning
        if (tokenCost > 0 && tokenInfo?.isLow) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                text: `Low tokens. You have ${tokenInfo.tokensRemaining} tokens remaining.`,
                isUser: false,
                timestamp: new Date(),
            }]);
        }

        const userMessage: Message = {
            id: Date.now().toString(),
            text: inputText.trim() || (file ? `Analyzing: ${file.name}` : ''),
            isUser: true,
            timestamp: new Date(),
            file: file ? { name: file.name, type: file.type, size: file.size } : undefined,
        };

        setMessages(prev => [...prev, userMessage]);
        setInputText('');
        setIsLoading(true);
        safeHaptic(Haptics.ImpactFeedbackStyle.Light);
        animateMessage();

        try {
            // Deduct tokens only for cloud mode.
            if (tokenCost > 0) {
                await deductTokens(tokenCost);
            }

            // Cloud mode prefers the provider-racing API first.
            if (useModel === 'cloud' && user?.id) {
                try {
                    const response = await smartModeAPI.chat({
                        message: userMessage.text,
                        conversation_history: messages.slice(-10).map(m => ({
                            text: m.text,
                            isUser: m.isUser
                        })),
                        user_id: user.id,
                        max_tokens: 500
                    });

                    const aiMessage: Message = {
                        id: (Date.now() + 1).toString(),
                        text: response.response,
                        isUser: false,
                        timestamp: new Date(),
                        metadata: {
                            model: response.model_used,
                            responseTime: response.response_time
                        }
                    };

                    const nextMessages = [...messages, userMessage, aiMessage];
                    setMessages(nextMessages);
                    animateMessage();
                    void saveToHistory(nextMessages);
                    return;
                } catch (smartError) {
                    console.error('Cloud mode failed over to direct runtime:', smartError);
                }
            }

            // Check for image generation command (/image or /imagine)
            const isImageCommand = userMessage.text.toLowerCase().startsWith('/image ') ||
                userMessage.text.toLowerCase().startsWith('/imagine ');
            if (isImageCommand) {
                const prompt = userMessage.text.toLowerCase().startsWith('/imagine ')
                    ? userMessage.text.slice(9).trim()
                    : userMessage.text.slice(7).trim();

                const response = await whisperAPI.generateImage({
                    prompt,
                    negativePrompt: 'blurry, bad quality, distorted, ugly, low resolution, watermark, text, signature',
                    width: 512,
                    height: 512,
                    numSteps: 25,
                    guidanceScale: 7.5,
                    modelId: 'dreamshaper-8',
                    // Add token params
                    ...getApiParams(),
                });

                const aiMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    text: `Here is your image for: "${prompt}"`,
                    imageUri: response.image_url,
                    isUser: false,
                    timestamp: new Date(),
                };
                const nextMessages = [...messages, userMessage, aiMessage];
                setMessages(nextMessages);
                animateMessage();
                void saveToHistory(nextMessages);
                return;
            }

            let responseText: string;

            // If a file is attached, analyze it first
            if (file) {
                try {
                    const question = inputText.trim() || 'Summarize this document and tell me what it contains.';
                    const response = await whisperAPI.analyzeFile(
                        { uri: file.uri, name: file.name, type: file.type },
                        question
                    );
                    responseText = response.answer || 'I could not analyze this file. Please try again.';
                } catch (fileError) {
                    console.error('File analysis failed:', fileError);
                    responseText = 'Sorry, I had trouble analyzing that file. Please make sure the file is readable and try again.';
                }
            } else {
                const systemPrompt = getSystemPrompt();

                // Prepare history (last 10 messages, excluding current)
                const history = messages.slice(-10).map(m => ({
                    role: (m.isUser ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: m.text,
                }));

                // Use streaming for better UX
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
                            systemPrompt,
                            maxTokens: 384,
                            temperature: 0.7,
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
                                { role: 'user' as const, content: userMessage.text }
                            ],
                            systemPrompt,
                            temperature: 0.7,
                            maxTokens: 512,
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
                        // console.log('Stream aborted by user');
                        return;
                    }
                    // Fallback to non-streaming on error
                    console.error('Streaming error, falling back:', streamError);

                    if (useModel === 'local') {
                        responseText = 'Local model error. Please ensure a model is downloaded and selected in the Models tab.';
                    } else if (useModel === 'self-learner') {
                        responseText = 'Self-learner runtime is not ready yet. Train the built-in transformer from the server and try again.';
                    } else {
                        const response: ChatResponse = await whisperAPI.chat({
                            message: userMessage.text,
                            useRAG: useRag,
                            systemPrompt,
                            history,
                            smartMode: useModel === 'cloud',
                            isLocal: useModel !== 'cloud',
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
                id: (Date.now() + 1).toString(),
                text: responseText,
                isUser: false,
                timestamp: new Date(),
            };
            const nextMessages = [...messages, userMessage, aiMessage];
            setMessages(nextMessages);
            safeHaptic(Haptics.ImpactFeedbackStyle.Light);
            animateMessage();
            void saveToHistory(nextMessages);
        } catch (error) {
            console.error('Message send error:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                text: "Sorry, I couldn't connect. Please check if the server is running.",
                isUser: false,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
            setProgressStatus('');
        }
    }, [
        inputText,
        isLoading,
        useModel,
        useRag,
        animateMessage,
        getSystemPrompt,
        createImageMode,
        generateImage,
        messages,
        checkTokens,
        deductTokens,
        getApiParams,
        getTokenCost,
        tokenInfo,
        user,
        saveToHistory,
    ]);

    const loadHistory = useCallback((history: ChatHistory) => {
        setMessages(history.messages);
        setCurrentChatId(history.id);
    }, []);

    const startNewChat = useCallback(() => {
        if (messages.length > 0) {
            saveToHistory();
        }
        setMessages([]);
        setInputText('');
        setCurrentChatId(null);
    }, [messages, saveToHistory]);

    const stopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsStreaming(false);
            setIsLoading(false);

            // Save partial streamed message if exists
            if (streamingMessage.trim()) {
                const aiMessage: Message = {
                    id: Date.now().toString(),
                    text: streamingMessage + ' [stopped]',
                    isUser: false,
                    timestamp: new Date(),
                };
                setMessages(prev => [...prev, aiMessage]);
                setStreamingMessage('');
            }
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
        startNewChat,
        fadeAnim,
    };
}

export default useChat;
