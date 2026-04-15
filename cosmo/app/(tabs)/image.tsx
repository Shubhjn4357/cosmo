import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Linking,
    Modal,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { AdvancedImageParams as AdvancedImageParamsComponent, defaultAdvancedParams, AdvancedImageParams as AdvancedImageParamsType } from '@/components/AdvancedImageParams';
import { AuthGate } from '@/components/AuthGate';
import { ModelPickerModal } from '@/components/ModelPickerModal';
import { SkeletonImage } from '@/components/SkeletonImage';
import { useToast } from '@/components/Toast';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { cosmoAPI, ImageModel, ImageResponse } from '@/services/api';

const DEFAULT_MODEL_ID = 'cyberrealistic-v9';

export default function ImageScreenWrapper() {
    return (
        <AuthGate feature="Image Generation">
            <ImageScreen />
        </AuthGate>
    );
}

function ImageScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const toast = useToast();

    const [prompt, setPrompt] = useState('');
    const [generatedImage, setGeneratedImage] = useState<ImageResponse | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDownloadModal, setShowDownloadModal] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [showModelPicker, setShowModelPicker] = useState(false);
    const [modelsLoading, setModelsLoading] = useState(true);
    const [serverModels, setServerModels] = useState<ImageModel[]>([]);
    const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID);
    const [advancedParams, setAdvancedParams] = useState<AdvancedImageParamsType>(defaultAdvancedParams);
    const [showAdvancedParams, setShowAdvancedParams] = useState(false);

    const examplePrompts = useMemo(
        () => [
            'Cinematic rainy street at night with neon reflections',
            'Elegant portrait with soft natural light and realistic skin',
            'Fantasy warrior standing in a misty forest',
            'Minimal product photo on a sculptural studio background',
        ],
        []
    );

    const loadServerModels = useCallback(async () => {
        setModelsLoading(true);
        try {
            const models = await cosmoAPI.getImageModels({ includeAdult: true, includeEdit: false });
            const promptModels = models.filter((model) => (
                model.downloadable
                && model.supports_server !== false
                && model.supports_text_prompt !== false
                && /\.(safetensors|ckpt)$/i.test(model.filename || '')
            ));
            setServerModels(promptModels);

            const activeIds = new Set(promptModels.map((model) => model.id));
            if (!activeIds.has(selectedModelId)) {
                const fallback = promptModels.find((model) => model.recommended) || promptModels[0];
                if (fallback) {
                    setSelectedModelId(fallback.id);
                }
            }
        } catch (err) {
            console.error('Failed to load approved image models:', err);
            toast.error('Image Models', 'Could not load the approved image catalog.');
            setServerModels([]);
        } finally {
            setModelsLoading(false);
        }
    }, [selectedModelId, toast]);

    useEffect(() => {
        void loadServerModels();
    }, [loadServerModels]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadServerModels();
        setRefreshing(false);
    }, [loadServerModels]);

    const selectedModel = useMemo(
        () => serverModels.find((model) => model.id === selectedModelId) || null,
        [serverModels, selectedModelId]
    );

    const generateImage = async () => {
        if (!prompt.trim() || isGenerating) return;

        setIsGenerating(true);
        setError(null);
        setGeneratedImage(null);

        try {
            const response = await cosmoAPI.generateImage({
                prompt,
                negativePrompt: advancedParams.negativePrompt,
                modelId: selectedModelId,
                width: advancedParams.width,
                height: advancedParams.height,
                numSteps: advancedParams.steps,
                guidanceScale: advancedParams.cfgScale,
                isLocal: true,
            });
            setGeneratedImage(response);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to generate image';
            setError(message);
        } finally {
            setIsGenerating(false);
        }
    };

    const downloadImage = async () => {
        if (!generatedImage?.image_url) return;
        setShowDownloadModal(false);
        try {
            await Linking.openURL(generatedImage.image_url);
            toast.success('Opened', 'Image opened in your browser. Long-press there to save it.');
        } catch (err) {
            toast.error('Download Failed', 'Could not open the generated image.');
        }
    };

    const bottomPadding = Math.max(insets.bottom, 16) + spacing.lg;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <View style={styles.headerBar}>
                    <View>
                        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Create</Text>
                        <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>
                            Downloaded models running on your server
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
                    <View style={[styles.modelSelector, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                        <View style={[styles.modeIndicator, { backgroundColor: `${theme.colors.primary}20` }]}>
                            <Ionicons name="hardware-chip-outline" size={16} color={theme.colors.primary} />
                            <Text style={[styles.modeText, { color: theme.colors.primary }]}>
                                Local server image runtime
                            </Text>
                        </View>

                        <View style={styles.modelSelectorRow}>
                            <Text style={[styles.modelLabel, { color: theme.colors.textMuted }]}>Model:</Text>
                            <TouchableOpacity
                                style={[styles.modelButton, { backgroundColor: theme.colors.surfaceLight }]}
                                onPress={() => setShowModelPicker(true)}
                            >
                                <Text style={[styles.modelButtonText, { color: theme.colors.text }]} numberOfLines={1}>
                                    {selectedModel?.name || 'Select Model'}
                                </Text>
                                <Ionicons name="chevron-down" size={20} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>

                        {selectedModel && (
                            <Text style={[styles.modelMeta, { color: theme.colors.textSecondary }]}>
                                {selectedModel.description}
                                {selectedModel.adult ? ' 18+ enabled.' : ''}
                            </Text>
                        )}
                    </View>

                    <View style={styles.inputSection}>
                        <TextInput
                            style={[
                                styles.promptInput,
                                {
                                    color: theme.colors.text,
                                    backgroundColor: theme.colors.surface,
                                    borderColor: theme.colors.surfaceBorder,
                                },
                            ]}
                            value={prompt}
                            onChangeText={setPrompt}
                            placeholder="Describe the image you want..."
                            placeholderTextColor={theme.colors.textMuted}
                            multiline
                            maxLength={500}
                        />

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

                        <AdvancedImageParamsComponent
                            params={advancedParams}
                            onChange={(updates) => setAdvancedParams({ ...advancedParams, ...updates })}
                            visible={showAdvancedParams}
                            onToggle={() => setShowAdvancedParams(!showAdvancedParams)}
                        />

                        <TouchableOpacity
                            style={[
                                styles.generateButton,
                                { backgroundColor: theme.colors.primary },
                                (!prompt.trim() || isGenerating || modelsLoading) && styles.generateButtonDisabled,
                            ]}
                            onPress={generateImage}
                            disabled={!prompt.trim() || isGenerating || modelsLoading}
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

                    <View style={styles.resultSection}>
                        {modelsLoading && (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="large" color={theme.colors.primary} />
                                <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                                    Loading approved image models...
                                </Text>
                            </View>
                        )}

                        {isGenerating && !generatedImage && <SkeletonImage showProgress={false} />}

                        {error && (
                            <View style={[styles.errorContainer, { backgroundColor: theme.colors.error + '20' }]}>
                                <Ionicons name="alert-circle" size={32} color={theme.colors.error} />
                                <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
                            </View>
                        )}

                        {generatedImage && (
                            <View style={[styles.imageContainer, { backgroundColor: theme.colors.surface }]}>
                                <Image source={{ uri: generatedImage.image_url }} style={styles.generatedImage} resizeMode="contain" />
                                <View style={styles.imageInfo}>
                                    <Text style={[styles.imagePrompt, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                                        "{generatedImage.prompt}"
                                    </Text>
                                    <TouchableOpacity
                                        style={[styles.downloadButton, { backgroundColor: theme.colors.primary }]}
                                        onPress={() => setShowDownloadModal(true)}
                                    >
                                        <Ionicons name="download-outline" size={18} color="#fff" />
                                        <Text style={styles.downloadButtonText}>Download</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}

                        {!modelsLoading && !isGenerating && !error && !generatedImage && (
                            <View style={styles.placeholderContainer}>
                                <Ionicons name="image-outline" size={64} color={theme.colors.surfaceBorder} />
                                <Text style={[styles.placeholderText, { color: theme.colors.textMuted }]}>
                                    Your generated image will appear here.
                                </Text>
                            </View>
                        )}
                    </View>
                </ScrollView>
            </SafeAreaView>

            <Modal visible={showDownloadModal} transparent animationType="fade" onRequestClose={() => setShowDownloadModal(false)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDownloadModal(false)}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Download Image</Text>
                        <Text style={[styles.modalHint, { color: theme.colors.textSecondary }]}>
                            Open the generated image in your browser and save it from there.
                        </Text>
                        <TouchableOpacity style={[styles.downloadPrimary, { backgroundColor: theme.colors.primary }]} onPress={downloadImage}>
                            <Ionicons name="open-outline" size={18} color="#fff" />
                            <Text style={styles.downloadPrimaryText}>Open Image</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.cancelButton, { backgroundColor: theme.colors.surfaceLight }]}
                            onPress={() => setShowDownloadModal(false)}
                        >
                            <Text style={[styles.cancelButtonText, { color: theme.colors.text }]}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            <ModelPickerModal
                visible={showModelPicker}
                onClose={() => setShowModelPicker(false)}
                serverModels={serverModels}
                localModels={[]}
                selectedModelId={selectedModelId}
                onSelectModel={(id) => setSelectedModelId(id)}
                useLocal={false}
                onToggleLocal={() => {}}
                downloadedModels={[]}
                showDownloadOptions={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    scrollView: { flex: 1 },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.md,
    },
    headerTitle: { fontSize: fontSize.xxl, fontWeight: '700' },
    headerSubtitle: { fontSize: fontSize.md, marginTop: spacing.xs },
    modelSelector: {
        marginHorizontal: spacing.lg,
        marginBottom: spacing.md,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
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
    modeText: { fontSize: fontSize.sm, fontWeight: '600' },
    modelSelectorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    modelLabel: { fontSize: fontSize.sm, marginRight: spacing.sm },
    modelButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
    },
    modelButtonText: { fontSize: fontSize.sm, fontWeight: '500' },
    modelMeta: { fontSize: fontSize.sm, lineHeight: 20 },
    inputSection: { paddingHorizontal: spacing.lg, gap: spacing.md },
    promptInput: {
        minHeight: 100,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        fontSize: fontSize.md,
        textAlignVertical: 'top',
    },
    examplesScroll: { flexGrow: 0 },
    exampleChip: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.full,
        marginRight: spacing.sm,
    },
    exampleText: { fontSize: fontSize.sm },
    generateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
    },
    generateButtonDisabled: { opacity: 0.5 },
    generateButtonText: { fontSize: fontSize.md, fontWeight: '600', color: '#fff' },
    resultSection: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, minHeight: 300 },
    loadingContainer: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
    loadingText: { fontSize: fontSize.md },
    errorContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        padding: spacing.lg,
        borderRadius: borderRadius.lg,
    },
    errorText: { fontSize: fontSize.md, textAlign: 'center' },
    imageContainer: { borderRadius: borderRadius.lg, overflow: 'hidden' },
    generatedImage: { width: '100%', aspectRatio: 1 },
    imageInfo: {
        padding: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
    },
    imagePrompt: { flex: 1, fontSize: fontSize.sm, fontStyle: 'italic' },
    downloadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
    },
    downloadButtonText: { fontSize: fontSize.sm, fontWeight: '600', color: '#fff' },
    placeholderContainer: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
    placeholderText: { fontSize: fontSize.md, textAlign: 'center' },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
    },
    modalContent: { width: '100%', maxWidth: 320, borderRadius: borderRadius.lg, padding: spacing.lg, gap: spacing.md },
    modalTitle: { fontSize: fontSize.lg, fontWeight: '600', textAlign: 'center' },
    modalHint: { fontSize: fontSize.sm, lineHeight: 20, textAlign: 'center' },
    downloadPrimary: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
    },
    downloadPrimaryText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
    cancelButton: { paddingVertical: spacing.md, borderRadius: borderRadius.md, alignItems: 'center' },
    cancelButtonText: { fontSize: fontSize.md, fontWeight: '500' },
});
