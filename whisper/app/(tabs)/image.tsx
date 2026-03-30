import React, { useState, useEffect, useCallback, memo } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Image,
    ActivityIndicator,
    ScrollView,
    Modal,
    Linking,
    Platform,
    RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { whisperAPI, ImageModel, ImageResponse } from '@/services/api';
import { GeminiSidebar } from '@/components/GeminiSidebar';
import { useChat, useAuth, useTokens } from '@/hooks';
import { useToast } from '@/components/Toast';
import { ModelPickerModal } from '@/components/ModelPickerModal';
import { AuthGate } from '@/components/AuthGate';
import { hordeAPI } from '@/services/hordeAPI';
import { SkeletonImage } from '@/components/SkeletonImage';
import { AdvancedImageParams as AdvancedImageParamsComponent, defaultAdvancedParams, AdvancedImageParams as AdvancedImageParamsType } from '@/components/AdvancedImageParams';

// Default fallback model if API fails
const DEFAULT_MODEL = { id: 'flux-schnell', name: 'FLUX Schnell', description: '🚀 Fast & Free' };

// Wrapper to require auth for image generation
export default function ImageScreenWrapper() {
    return (
        <AuthGate feature="Image Generation">
            <ImageScreen />
        </AuthGate>
    );
}

function ImageScreen() {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const { chatHistories, loadHistory, startNewChat } = useChat();
    const { tokenInfo, checkTokens, useTokens: deductTokens } = useTokens();
    const toast = useToast();
    const [showSidebar, setShowSidebar] = useState(false);

    // Image generation state
    const [prompt, setPrompt] = useState('');
    const [generatedImage, setGeneratedImage] = useState<ImageResponse | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDownloadModal, setShowDownloadModal] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // Task polling state
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const [generationProgress, setGenerationProgress] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [infoMessage, setInfoMessage] = useState<string | null>(null);

    // Models from AI Horde API (server-fetched)
    const [serverModels, setServerModels] = useState<ImageModel[]>([]);
    const [modelsLoading, setModelsLoading] = useState(true);

    // Load models from server on mount
    useEffect(() => {
        loadServerModels();
    }, []);

    const loadServerModels = async () => {
        setModelsLoading(true);
        try {
            // Fetch models from AI Horde via server
            const models = await hordeAPI.getModels('image');
            setServerModels((models.models || []) as ImageModel[]);
        } catch (err) {
            console.error('Failed to load AI Horde models:', err);
            toast.error('Error', 'Failed to load models');
        } finally {
            setModelsLoading(false);
        }
    };

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadServerModels();
        setRefreshing(false);
    }, []);

    // Model selection state
    const [selectedModelId, setSelectedModelId] = useState('CyberRealistic Pony');
    const [showModelPicker, setShowModelPicker] = useState(false);

    // Advanced image parameters for Horde
    const [advancedParams, setAdvancedParams] = useState<AdvancedImageParamsType>(defaultAdvancedParams);
    const [showAdvancedParams, setShowAdvancedParams] = useState(false);

    const generateImage = async () => {
        if (!prompt.trim() || isGenerating) return;

        // Check tokens (5 for image generation)
        const hasTokens = await checkTokens(5);
        if (!hasTokens) {
            toast.error('Insufficient Tokens', 'You need 5 tokens to generate an image. Upgrade to Pro!');
            return;
        }

        // Show low token warning
        if (tokenInfo?.isLow) {
            toast.warning('Low Tokens', `You have ${tokenInfo.tokensRemaining} tokens remaining (< 20%)`);
        }

        setIsGenerating(true);
        setError(null);
        setInfoMessage(null);
        setGeneratedImage(null);
        setGenerationProgress(0);

        try {
            setInfoMessage('🎨 Starting AI Horde image generation...');

            // Deduct tokens
            await deductTokens(5);

            // Call AI Horde API (returns task_id immediately)
            const result = await hordeAPI.generateImage({
                prompt: advancedParams.enhancePrompt ? prompt : prompt,
                negative_prompt: advancedParams.negativePrompt,
                model: selectedModelId || 'CyberRealistic Pony',
                width: advancedParams.width,
                height: advancedParams.height,
                steps: advancedParams.steps,
                cfg_scale: advancedParams.cfgScale,
                sampler: 'k_euler_a',
                seed: advancedParams.seed > 0 ? advancedParams.seed : undefined,
                enhance_prompt: advancedParams.enhancePrompt,
            });

            // Store task ID for polling
            const taskId = result.image_url; // AI Horde returns image directly for now
            setCurrentTaskId(taskId);
            setInfoMessage('⏳ Image queued on AI Horde, polling for result...');

            // Poll for completion
            let completed = false;
            let attempts = 0;
            const maxAttempts = 60; // 3 minutes max

            while (!completed && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 3000)); // Poll every 3s

                try {
                    const status = await hordeAPI.getTaskStatus(taskId);

                    if (status.status === 'completed' && status.result) {
                        setGeneratedImage({
                            image_url: status.result.image_url,
                            prompt: prompt,
                            seed: status.result.seed || 0,
                        });
                        setInfoMessage(null);
                        completed = true;
                    } else if (status.status === 'failed') {
                        throw new Error(status.error || 'Generation failed');
                    } else {
                        // Still processing
                        setInfoMessage(`⏳ Queue position: ${attempts}/${maxAttempts}`);
                    }
                } catch (pollError) {
                    console.error('Poll error:', pollError);
                }

                attempts++;
            }

            if (!completed) {
                throw new Error('Generation timeout - check back later');
            }

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate image');
        } finally {
            setIsGenerating(false);
            setGenerationProgress(0);
        }
    };

    const downloadImage = async (quality: 'original' | 'high' | 'medium' | 'low') => {
        if (!generatedImage?.image_url) return;
        
        setIsDownloading(true);
        setShowDownloadModal(false);
        
        try {
            // Open the image URL in browser where user can save it
            await Linking.openURL(generatedImage.image_url);
            toast.success('Download', 'Image opened in browser. Long-press to save.');
        } catch (err) {
            toast.error('Error', 'Failed to open image');
        } finally {
            setIsDownloading(false);
        }
    };


    const examplePrompts = [
        'A serene mountain lake',
        'Futuristic city at night',
        'Magical forest',
        'Abstract art',
    ];

    const bottomPadding = Math.max(insets.bottom, 16) + spacing.lg;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Sidebar */}
            <GeminiSidebar
                visible={showSidebar}
                onClose={() => setShowSidebar(false)}
                histories={chatHistories}
                onSelectHistory={loadHistory}
                onNewChat={startNewChat}
            />

            <SafeAreaView style={styles.safeArea} edges={['top']}>
                {/* Header with hamburger menu */}
                <View style={styles.headerBar}>
                    <TouchableOpacity
                        onPress={() => setShowSidebar(true)}
                        style={styles.menuButton}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons name="menu" size={26} color={theme.colors.text} />
                    </TouchableOpacity>
                    <View>
                        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Create</Text>
                        <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>
                            Generate images with AI
                        </Text>
                    </View>
                </View>

                <ScrollView 
                    style={styles.scrollView} 
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: bottomPadding }}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
                    }
                >

                    {/* Model Selector */}
                    <View style={[styles.modelSelector, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                        {/* Mode Indicator */}
                        <View style={[styles.modeIndicator, { backgroundColor: '#3b82f620' }]}>
                            <Ionicons
                                name="cloud"
                                size={16}
                                color="#3b82f6"
                            />
                            <Text style={[styles.modeText, { color: '#3b82f6' }]}>
                                ☁️ Server Model (Cloud)
                            </Text>
                            <Text style={[styles.headerSubtitle, { color: '#2f2f2f' }]}>
                                Some time It Take Time to Generate Becouse of Oue
                            </Text>

                        </View>

                        {/* Model Selection */}
                        <View style={styles.modelSelectorRow}>
                            <Text style={[styles.modelLabel, { color: theme.colors.textMuted }]}>Model:</Text>
                            <TouchableOpacity
                                style={[styles.modelButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={() => setShowModelPicker(true)}
                            >
                                <Text style={[styles.modelButtonText, { color: theme.colors.text }]} numberOfLines={1}>
                                    {selectedModelId || 'Select Model'}
                                </Text>
                                <Ionicons name="chevron-down" size={20} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Prompt Input */}
                    <View style={styles.inputSection}>
                        <TextInput
                            style={[styles.promptInput, { 
                                color: theme.colors.text, 
                                backgroundColor: theme.colors.surface,
                                borderColor: theme.colors.surfaceBorder 
                            }]}
                            value={prompt}
                            onChangeText={setPrompt}
                            placeholder="Describe your image..."
                            placeholderTextColor={theme.colors.textMuted}
                            multiline
                            maxLength={500}
                        />

                        {/* Example Prompts */}
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.examplesScroll}>
                            {examplePrompts.map((example, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={[styles.exampleChip, { backgroundColor: theme.colors.surfaceLight }]}
                                    onPress={() => setPrompt(example)}
                                >
                                    <Text style={[styles.exampleText, { color: theme.colors.textSecondary }]}>
                                        {example}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        {/* Advanced Parameters */}
                        <AdvancedImageParamsComponent
                            params={advancedParams}
                            onChange={(updates) => setAdvancedParams({ ...advancedParams, ...updates })}
                            visible={showAdvancedParams}
                            onToggle={() => setShowAdvancedParams(!showAdvancedParams)}
                        />

                        {/* Generate Button */}
                        <TouchableOpacity
                            style={[
                                styles.generateButton, 
                                { backgroundColor: theme.colors.primary },
                                (!prompt.trim() || isGenerating) && styles.generateButtonDisabled
                            ]}
                            onPress={generateImage}
                            disabled={!prompt.trim() || isGenerating}
                        >
                            {isGenerating ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="sparkles" size={20} color="#fff" />
                                    <Text style={styles.generateButtonText}>Generate</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* Result Section */}
                    <View style={styles.resultSection}>
                        {isGenerating && (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="large" color={theme.colors.primary} />
                                <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                                    Creating your image...
                                </Text>
                            </View>
                        )}

                        {error && (
                            <View style={[styles.errorContainer, { backgroundColor: theme.colors.error + '20' }]}>
                                <Ionicons name="alert-circle" size={32} color={theme.colors.error} />
                                <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
                            </View>
                        )}

                        {infoMessage && !error && (
                            <View style={[styles.infoContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                                <Ionicons name="information-circle" size={24} color={theme.colors.primary} />
                                <Text style={[styles.infoText, { color: theme.colors.primary }]}>{infoMessage}</Text>
                            </View>
                        )}

                        {/* Show skeleton during generation */}
                        {isGenerating && !generatedImage && (
                            <SkeletonImage
                                showProgress={true}
                                progress={generationProgress}
                            />
                        )}

                        {generatedImage && (
                            <View style={[styles.imageContainer, { backgroundColor: theme.colors.surface }]}>
                                <Image
                                    source={{ uri: generatedImage.image_url }}
                                    style={styles.generatedImage}
                                    resizeMode="contain"
                                />
                                <View style={styles.imageInfo}>
                                    <Text style={[styles.imagePrompt, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                                        "{generatedImage.prompt}"
                                    </Text>
                                    <TouchableOpacity
                                        style={[styles.downloadButton, { backgroundColor: theme.colors.primary }]}
                                        onPress={() => setShowDownloadModal(true)}
                                        disabled={isDownloading}
                                    >
                                        {isDownloading ? (
                                            <ActivityIndicator color="#fff" size="small" />
                                        ) : (
                                            <>
                                                <Ionicons name="download-outline" size={18} color="#fff" />
                                                <Text style={styles.downloadButtonText}>Download</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}

                        {!isGenerating && !error && !generatedImage && (
                            <View style={styles.placeholderContainer}>
                                <Ionicons name="image-outline" size={64} color={theme.colors.surfaceBorder} />
                                <Text style={[styles.placeholderText, { color: theme.colors.textMuted }]}>
                                    Your image will appear here
                                </Text>
                            </View>
                        )}
                    </View>
                </ScrollView>
            </SafeAreaView>

            {/* Download Quality Modal */}
            <Modal
                visible={showDownloadModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowDownloadModal(false)}
            >
                <TouchableOpacity 
                    style={styles.modalOverlay} 
                    activeOpacity={1} 
                    onPress={() => setShowDownloadModal(false)}
                >
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Download Quality</Text>
                        
                        {['original', 'high', 'medium', 'low'].map((quality) => (
                            <TouchableOpacity
                                key={quality}
                                style={[styles.qualityOption, { borderBottomColor: theme.colors.surfaceBorder }]}
                                onPress={() => downloadImage(quality as any)}
                            >
                                <Ionicons 
                                    name={quality === 'original' ? 'star' : 'image'} 
                                    size={20} 
                                    color={quality === 'original' ? theme.colors.primary : theme.colors.textSecondary} 
                                />
                                <View style={styles.qualityInfo}>
                                    <Text style={[styles.qualityLabel, { color: theme.colors.text }]}>
                                        {quality.charAt(0).toUpperCase() + quality.slice(1)}
                                    </Text>
                                    <Text style={[styles.qualityHint, { color: theme.colors.textMuted }]}>
                                        {quality === 'original' ? '512x512' : quality === 'high' ? '1024x1024' : quality === 'medium' ? '512x512' : '256x256'}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        ))}

                        <TouchableOpacity
                            style={[styles.cancelButton, { backgroundColor: theme.colors.surfaceLight }]}
                            onPress={() => setShowDownloadModal(false)}
                        >
                            <Text style={[styles.cancelButtonText, { color: theme.colors.text }]}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Model Picker Modal - No downloads here, only in Models tab */}
            <ModelPickerModal
                visible={showModelPicker}
                onClose={() => setShowModelPicker(false)}
                serverModels={serverModels}
                localModels={[]}
                selectedModelId={selectedModelId}
                onSelectModel={(id) => {
                    setSelectedModelId(id);
                }}
                useLocal={false}
                onToggleLocal={() => { }}
                downloadedModels={[]}
                showDownloadOptions={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    safeArea: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    header: {
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.lg,
    },
    headerTitle: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    headerSubtitle: {
        fontSize: fontSize.md,
        marginTop: spacing.xs,
    },
    inputSection: {
        paddingHorizontal: spacing.lg,
        gap: spacing.md,
    },
    promptInput: {
        minHeight: 100,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        fontSize: fontSize.md,
        textAlignVertical: 'top',
    },
    examplesScroll: {
        flexGrow: 0,
    },
    exampleChip: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.full,
        marginRight: spacing.sm,
    },
    exampleText: {
        fontSize: fontSize.sm,
    },
    generateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
    },
    generateButtonDisabled: {
        opacity: 0.5,
    },
    generateButtonText: {
        fontSize: fontSize.md,
        fontWeight: '600',
        color: '#fff',
    },
    resultSection: {
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.xl,
        minHeight: 300,
    },
    loadingContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        padding: spacing.xl,
    },
    loadingText: {
        fontSize: fontSize.md,
    },
    errorContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        padding: spacing.lg,
        borderRadius: borderRadius.lg,
    },
    errorText: {
        fontSize: fontSize.md,
        textAlign: 'center',
    },
    infoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.md,
    },
    infoText: {
        flex: 1,
        fontSize: fontSize.sm,
    },
    imageContainer: {
        borderRadius: borderRadius.lg,
        overflow: 'hidden',
    },
    generatedImage: {
        width: '100%',
        aspectRatio: 1,
    },
    imageInfo: {
        padding: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
    },
    imagePrompt: {
        flex: 1,
        fontSize: fontSize.sm,
        fontStyle: 'italic',
    },
    downloadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
    },
    downloadButtonText: {
        fontSize: fontSize.sm,
        fontWeight: '600',
        color: '#fff',
    },
    placeholderContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        padding: spacing.xl,
    },
    placeholderText: {
        fontSize: fontSize.md,
        textAlign: 'center',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
    },
    modalContent: {
        width: '100%',
        maxWidth: 320,
        borderRadius: borderRadius.lg,
        padding: spacing.lg,
    },
    modalTitle: {
        fontSize: fontSize.lg,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: spacing.md,
    },
    qualityOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    qualityInfo: {
        flex: 1,
    },
    qualityLabel: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    qualityHint: {
        fontSize: fontSize.xs,
    },
    cancelButton: {
        marginTop: spacing.md,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
        alignItems: 'center',
    },
    cancelButtonText: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    modelSelector: {
        marginHorizontal: spacing.lg,
        marginBottom: spacing.md,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
    },
    modelSelectorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    modelLabel: {
        fontSize: fontSize.sm,
        marginRight: spacing.sm,
    },
    modelButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
    },
    modelButtonText: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    localToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    toggleBox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    toggleLabel: {
        fontSize: fontSize.sm,
    },
    unavailableText: {
        fontSize: fontSize.xs,
        marginLeft: spacing.xs,
    },
    modeIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
        marginBottom: spacing.sm,
    },
    modeText: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.md,
    },
    menuButton: {
        padding: spacing.xs,
    },
});
