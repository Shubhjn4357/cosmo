import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { useToast } from '@/components/Toast';
import { borderRadius, fontSize, spacing, useTheme } from '@/constants/theme';
import { useAIRuntime } from '@/hooks';
import deviceWarnings, { type DeviceResources, type ModelCompatibility } from '@/services/deviceWarnings';
import llmBackend from '@/services/llmBackend';
import { MODEL_MODE_DESCRIPTIONS, MODEL_MODE_LABELS, type ModelType } from '@/types';
import { ensureModelsDirectoryExists, getModelsDirectory, getModelsDirectoryWithProtocol } from '@/utils/modelPaths';

interface LocalModel {
    id: string;
    name: string;
    size: string;
    type: 'chat' | 'image';
    description: string;
    downloadUrl?: string;
    isDownloaded: boolean;
    filePath?: string;
    minSizeBytes: number;
}

interface ModelDeviceAdvice {
    label: string;
    detail: string;
    severity: 'success' | 'info' | 'warning' | 'critical';
    recommendation?: string;
}

const GB = 1024 * 1024 * 1024;
const AVAILABLE_MODELS: LocalModel[] = [
    { id: 'tinyllama-1.1b-q4', name: 'TinyLlama 1.1B (Q4)', size: '669 MB', minSizeBytes: 600 * 1024 * 1024, type: 'chat', description: 'Fastest model. Great for basic chat and quick responses.', downloadUrl: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf', isDownloaded: false },
    { id: 'tinyllama-1.1b-q2', name: 'TinyLlama 1.1B (Q2)', size: '450 MB', minSizeBytes: 400 * 1024 * 1024, type: 'chat', description: 'Ultra-compressed version. Very fast, minimal quality loss.', downloadUrl: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q2_K.gguf', isDownloaded: false },
    { id: 'stablelm-zephyr-3b-q4', name: 'StableLM Zephyr 3B (Q4)', size: '1.9 GB', minSizeBytes: Math.round(1.5 * GB), type: 'chat', description: 'Excellent quality for size. Fast and capable.', downloadUrl: 'https://huggingface.co/TheBloke/stablelm-zephyr-3b-GGUF/resolve/main/stablelm-zephyr-3b.Q4_K_M.gguf', isDownloaded: false },
    { id: 'llama-3.2-1b-q4', name: 'Llama 3.2 1B (Q4)', size: '750 MB', minSizeBytes: 700 * 1024 * 1024, type: 'chat', description: "Meta's latest 1B model. Excellent quality for on-device.", downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf', isDownloaded: false },
    { id: 'llama-3.2-1b-q2', name: 'Llama 3.2 1B (Q2)', size: '500 MB', minSizeBytes: 450 * 1024 * 1024, type: 'chat', description: 'Compressed Llama 3.2. Very fast with good quality.', downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q2_K.gguf', isDownloaded: false },
];

const MODE_ICONS: Record<ModelType, keyof typeof Ionicons.glyphMap> = {
    cloud: 'globe-outline',
    server: 'albums-outline',
    'self-learner': 'analytics-outline',
    local: 'phone-portrait-outline',
};

const modelSizeGb = (model: LocalModel) => model.minSizeBytes / GB;
const estimateRamGb = (model: LocalModel) => Math.max(modelSizeGb(model) * 1.6, modelSizeGb(model) + 0.75);
const quantizationLabel = (model: LocalModel) => model.id.match(/q\d(?:_[a-z0-9]+)?/i)?.[0]?.toUpperCase() ?? 'Q4';

export default function ModelsScreen() {
    const { theme } = useTheme();
    const toast = useToast();
    const { mode, setMode, cloudModel } = useAIRuntime();
    const [models, setModels] = useState<LocalModel[]>(AVAILABLE_MODELS);
    const [deviceResources, setDeviceResources] = useState<DeviceResources | null>(null);
    const [compatibilityByModel, setCompatibilityByModel] = useState<Record<string, ModelCompatibility>>({});
    const [downloading, setDownloading] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [initializing, setInitializing] = useState<string | null>(null);
    const [activeModelPath, setActiveModelPath] = useState<string | null>(null);
    const modelsPathWithProtocol = getModelsDirectoryWithProtocol();
    const modelsPath = getModelsDirectory();

    useEffect(() => {
        void checkDownloadedModels();
        refreshActiveModel();
        void refreshDeviceResources();
    }, []);

    useEffect(() => {
        let cancelled = false;
        const loadCompatibility = async () => {
            const next: Record<string, ModelCompatibility> = {};
            for (const model of models) {
                next[model.id] = await deviceWarnings.checkModelCompatibility(
                    modelSizeGb(model),
                    estimateRamGb(model),
                    quantizationLabel(model)
                );
            }
            if (!cancelled) setCompatibilityByModel(next);
        };
        void loadCompatibility();
        return () => { cancelled = true; };
    }, [models, deviceResources]);

    const refreshDeviceResources = async () => {
        try {
            setDeviceResources(await deviceWarnings.getDeviceResources());
        } catch (error) {
            console.warn('Failed to load device resources:', error);
        }
    };

    const refreshActiveModel = () => {
        const currentPath = llmBackend.getCurrentLocalModelPath();
        setActiveModelPath(llmBackend.getCurrentBackendType() === 'local' ? currentPath : null);
    };

    const checkDownloadedModels = async () => {
        try {
            await ensureModelsDirectoryExists();
            const contents = await FileSystem.readDirectoryAsync(modelsPathWithProtocol);
            const files = contents.map((name) => ({
                name,
                fileUri: `${modelsPathWithProtocol}${name}`,
                configPath: `${modelsPath}${name}`,
            }));
            const resolved = await Promise.all(AVAILABLE_MODELS.map(async (model) => {
                const match = files.find((file) => file.name === `${model.id}.gguf`);
                if (!match) return { ...model, isDownloaded: false, filePath: undefined };
                const info = await FileSystem.getInfoAsync(match.fileUri);
                if (!info.exists || info.isDirectory || info.size < (model.minSizeBytes || 1024)) {
                    return { ...model, isDownloaded: false, filePath: undefined };
                }
                return { ...model, isDownloaded: true, filePath: match.configPath };
            }));
            setModels(resolved);
            refreshActiveModel();
        } catch (error) {
            console.error('Error checking models:', error);
            toast.error('Error', 'Failed to check downloaded models');
        }
    };

    const importModel = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
            if (result.canceled || !result.assets?.[0]) return;
            const pickedFile = result.assets[0];
            if (!pickedFile.name.toLowerCase().endsWith('.gguf')) {
                Alert.alert('Invalid File', 'Please select a GGUF model file (.gguf extension)', [{ text: 'OK' }]);
                return;
            }
            await ensureModelsDirectoryExists();
            toast.info('Importing', `Importing ${pickedFile.name}...`);
            const destination = `${modelsPathWithProtocol}${pickedFile.name}`;
            await FileSystem.copyAsync({ from: pickedFile.uri, to: destination });
            const info = await FileSystem.getInfoAsync(destination);
            if (!info.exists || info.size <= 0) throw new Error('Import verification failed');
            toast.success('Imported', `${pickedFile.name} added to models`);
            await checkDownloadedModels();
        } catch (error) {
            console.error('Import error:', error);
            toast.error('Import Failed', `Could not import model file: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const downloadModel = async (model: LocalModel) => {
        if (!model.downloadUrl) return;
        try {
            setDownloading(model.id);
            setDownloadProgress(0);
            await ensureModelsDirectoryExists();
            toast.info('Downloading', `Downloading ${model.name}...`);
            const resumable = FileSystem.createDownloadResumable(model.downloadUrl, `${modelsPathWithProtocol}${model.id}.gguf`, {}, (progress) => {
                const total = progress.totalBytesExpectedToWrite || 1;
                setDownloadProgress((progress.totalBytesWritten / total) * 100);
            });
            const result = await resumable.downloadAsync();
            if (!result || result.status !== 200) throw new Error(`Download failed with status ${result?.status}`);
            const info = await FileSystem.getInfoAsync(result.uri);
            if (!info.exists || info.size < (model.minSizeBytes || 100)) throw new Error('Download incomplete or file corrupted');
            toast.success('Downloaded', `${model.name} is ready to use`);
            await checkDownloadedModels();
        } catch (error) {
            console.error('Download error:', error);
            toast.error('Download Failed', 'Please check your connection and try again');
            try {
                const fileUri = `${modelsPathWithProtocol}${model.id}.gguf`;
                const info = await FileSystem.getInfoAsync(fileUri);
                if (info.exists) await FileSystem.deleteAsync(fileUri);
            } catch {}
        } finally {
            setDownloading(null);
            setDownloadProgress(0);
        }
    };

    const deleteModel = async (model: LocalModel) => {
        Alert.alert('Delete Model', `Remove ${model.name} (${model.size})?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        if (!model.filePath) return;
                        const fileUri = model.filePath.startsWith('file://') ? model.filePath : `file://${model.filePath}`;
                        await FileSystem.deleteAsync(fileUri);
                        if (activeModelPath === model.filePath) setActiveModelPath(null);
                        toast.success('Deleted', `${model.name} removed`);
                        await checkDownloadedModels();
                    } catch (error) {
                        console.error('Delete error:', error);
                        toast.error('Error', 'Failed to delete model');
                    }
                },
            },
        ]);
    };

    const getAdvice = (model: LocalModel): ModelDeviceAdvice | null => {
        const compatibility = compatibilityByModel[model.id];
        if (!deviceResources || !compatibility) return null;
        const estimatedRam = estimateRamGb(model);
        const warning = compatibility.warnings[0];
        if (!compatibility.compatible) return { label: 'Too heavy', detail: warning?.message || `Estimated RAM ${estimatedRam.toFixed(1)} GB exceeds this device profile.`, severity: 'critical', recommendation: compatibility.recommendations[0] };
        if (compatibility.warnings.length > 0) return { label: 'Use with care', detail: warning?.message || `Estimated RAM ${estimatedRam.toFixed(1)} GB may be tight for this device.`, severity: warning?.severity === 'critical' ? 'critical' : 'warning', recommendation: compatibility.recommendations[0] };
        if (modelSizeGb(model) <= deviceResources.maxModelSize * 0.6) return { label: 'Recommended', detail: `Estimated RAM ${estimatedRam.toFixed(1)} GB on a ${deviceResources.deviceType} device profile.`, severity: 'success', recommendation: compatibility.recommendations[0] };
        return { label: 'Fits device', detail: `Estimated RAM ${estimatedRam.toFixed(1)} GB. Recommended model cap is ${deviceResources.maxModelSize.toFixed(1)} GB.`, severity: 'info', recommendation: compatibility.recommendations[0] };
    };

    const adviceTone = (advice: ModelDeviceAdvice) => {
        if (advice.severity === 'critical') return { bg: `${theme.colors.error}16`, border: `${theme.colors.error}30`, text: theme.colors.error, icon: 'warning-outline' as const };
        if (advice.severity === 'warning') return { bg: `${theme.colors.warning}16`, border: `${theme.colors.warning}30`, text: theme.colors.warning, icon: 'alert-circle-outline' as const };
        if (advice.severity === 'success') return { bg: `${theme.colors.success}16`, border: `${theme.colors.success}30`, text: theme.colors.success, icon: 'sparkles-outline' as const };
        return { bg: `${theme.colors.primary}12`, border: `${theme.colors.primary}24`, text: theme.colors.primary, icon: 'information-circle-outline' as const };
    };

    const rankedModels = [...models].sort((left, right) => {
        const score = (model: LocalModel) => {
            const advice = getAdvice(model);
            let value = 0;
            if (activeModelPath === model.filePath) value += 1000;
            if (model.isDownloaded) value += 200;
            if (advice?.label === 'Recommended') value += 120;
            else if (advice?.label === 'Fits device') value += 90;
            else if (advice?.label === 'Use with care') value += 50;
            else if (advice?.label === 'Too heavy') value += 10;
            return value - Math.round(modelSizeGb(model) * 10);
        };
        const delta = score(right) - score(left);
        return delta !== 0 ? delta : left.minSizeBytes - right.minSizeBytes;
    });

    const renderModelCard = ({ item }: { item: LocalModel }) => {
        const isDownloading = downloading === item.id;
        const isInitializing = initializing === item.id;
        const isRunning = activeModelPath === item.filePath;
        const advice = getAdvice(item);
        const tone = advice ? adviceTone(advice) : null;
        return (
            <View style={[styles.card, { backgroundColor: isRunning ? theme.colors.surfaceLight : theme.colors.surface, borderColor: isRunning ? theme.colors.primary : theme.colors.surfaceBorder }]}>
                <View style={styles.cardHeader}>
                    <View style={styles.modelInfo}>
                        <Text style={[styles.modelName, { color: theme.colors.text }]}>{item.name}</Text>
                        <Text style={[styles.modelSize, { color: theme.colors.textSecondary }]}>{item.size} | {item.type === 'chat' ? 'Chat' : 'Image'}</Text>
                    </View>
                    {item.isDownloaded && <View style={[styles.badge, { backgroundColor: `${theme.colors.success}20` }]}><Ionicons name="checkmark-circle" size={16} color={theme.colors.success} /><Text style={[styles.badgeText, { color: theme.colors.success }]}>Downloaded</Text></View>}
                </View>
                <Text style={[styles.description, { color: theme.colors.textSecondary }]}>{item.description}</Text>
                {advice && tone && <View style={[styles.advice, { backgroundColor: tone.bg, borderColor: tone.border }]}><View style={styles.adviceHeader}><Ionicons name={tone.icon} size={16} color={tone.text} /><Text style={[styles.adviceLabel, { color: tone.text }]}>{advice.label}</Text></View><Text style={[styles.adviceText, { color: theme.colors.textSecondary }]}>{advice.detail}</Text>{advice.recommendation && <Text style={[styles.adviceMeta, { color: theme.colors.textMuted }]}>{advice.recommendation}</Text>}</View>}
                {isDownloading && <View style={styles.progressContainer}><View style={[styles.progressBar, { backgroundColor: theme.colors.surfaceLight }]}><View style={[styles.progressFill, { backgroundColor: theme.colors.primary, width: `${downloadProgress}%` }]} /></View><Text style={[styles.progressText, { color: theme.colors.textMuted }]}>{downloadProgress.toFixed(0)}%</Text></View>}
                <View style={styles.cardActions}>
                    {!item.isDownloaded ? (
                        <TouchableOpacity style={[styles.button, { backgroundColor: theme.colors.primary }]} onPress={() => { void downloadModel(item); }} disabled={isDownloading}>
                            {isDownloading ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="download-outline" size={18} color="#fff" /><Text style={styles.buttonText}>Download</Text></>}
                        </TouchableOpacity>
                    ) : (
                        <>
                            <TouchableOpacity
                                style={[styles.button, isRunning ? { backgroundColor: theme.colors.success } : styles.buttonOutline, { borderColor: isRunning ? theme.colors.success : theme.colors.primary }]}
                                disabled={isInitializing}
                                onPress={async () => {
                                    if (isRunning || !item.filePath) return;
                                    try {
                                        setInitializing(item.id);
                                        await llmBackend.updateBackend('local', { modelPath: item.filePath, enabled: true });
                                        await llmBackend.setCurrentBackend('local');
                                        toast.info('Initializing', 'Loading model into memory...');
                                        await llmBackend.initializeBackend('local');
                                        await setMode('local');
                                        setActiveModelPath(item.filePath);
                                        toast.success('Running', 'Model active');
                                    } catch (error) {
                                        console.error('Failed to set model:', error);
                                        toast.error('Error', `Failed to load model: ${error instanceof Error ? error.message : String(error)}`);
                                    } finally {
                                        setInitializing(null);
                                    }
                                }}
                            >
                                {isInitializing ? <ActivityIndicator color={isRunning ? '#fff' : theme.colors.primary} size="small" /> : <><Ionicons name={isRunning ? 'radio-button-on' : 'play-circle-outline'} size={18} color={isRunning ? '#fff' : theme.colors.primary} /><Text style={[isRunning ? styles.buttonText : styles.buttonTextOutline, { color: isRunning ? '#fff' : theme.colors.primary }]}>{isRunning ? 'Running' : 'Use Model'}</Text></>}
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.iconButton, { backgroundColor: theme.colors.surfaceLight }]} onPress={() => { void deleteModel(item); }}><Ionicons name="trash-outline" size={18} color={theme.colors.error} /></TouchableOpacity>
                        </>
                    )}
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={styles.header}>
                <Text style={[styles.title, { color: theme.colors.text }]}>Local Models</Text>
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>Download models to use offline without cloud tokens.</Text>
            </View>
            {deviceResources && <View style={styles.section}><View style={[styles.deviceCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}><Text style={[styles.deviceTitle, { color: theme.colors.text }]}>Device Fit</Text><Text style={[styles.deviceSummary, { color: theme.colors.textSecondary }]}>{`${deviceResources.deviceType} profile | ${deviceResources.totalRam.toFixed(1)} GB RAM | target max ${deviceResources.maxModelSize.toFixed(1)} GB`}</Text><Text style={[styles.deviceMeta, { color: theme.colors.textMuted }]}>{`Available RAM ${deviceResources.availableRam.toFixed(1)} GB | thermal ${deviceResources.thermalState}`}</Text></View></View>}
            <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>AI Modes</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.colors.textSecondary }]}>Switch between hosted Gemini, your Whisper server, the self-learner transformer, and on-device GGUF inference.</Text>
                <View style={styles.modeGrid}>
                    {(Object.keys(MODEL_MODE_LABELS) as ModelType[]).map((modeOption) => {
                        const isActive = modeOption === mode;
                        return (
                            <TouchableOpacity key={modeOption} style={[styles.modeCard, { backgroundColor: isActive ? `${theme.colors.primary}14` : theme.colors.surface, borderColor: isActive ? theme.colors.primary : theme.colors.surfaceBorder }]} onPress={() => { void setMode(modeOption); toast.success('Mode Updated', `${MODEL_MODE_LABELS[modeOption]} mode is active`); }}>
                                <View style={styles.modeHeader}><Ionicons name={MODE_ICONS[modeOption]} size={18} color={isActive ? theme.colors.primary : theme.colors.textSecondary} /><Text style={[styles.modeLabel, { color: theme.colors.text }]}>{MODEL_MODE_LABELS[modeOption]}</Text></View>
                                <Text style={[styles.modeDescription, { color: theme.colors.textSecondary }]}>{MODEL_MODE_DESCRIPTIONS[modeOption]}</Text>
                                {modeOption === 'cloud' && <Text style={[styles.modeMeta, { color: theme.colors.primary }]}>Gemini model: {cloudModel}</Text>}
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>
            <TouchableOpacity style={[styles.importButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]} onPress={() => { void importModel(); }}><Ionicons name="cloud-upload-outline" size={20} color={theme.colors.primary} /><Text style={[styles.importText, { color: theme.colors.text }]}>Import Model from Storage</Text></TouchableOpacity>
            <FlatList data={rankedModels} renderItem={renderModelCard} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: spacing.lg },
    title: { fontSize: fontSize.xxl, fontWeight: '700' },
    subtitle: { fontSize: fontSize.md, marginTop: spacing.xs },
    section: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
    sectionTitle: { fontSize: fontSize.lg, fontWeight: '700' },
    sectionSubtitle: { fontSize: fontSize.sm, marginTop: spacing.xs, lineHeight: 20 },
    deviceCard: { borderWidth: 1, borderRadius: borderRadius.lg, padding: spacing.md, gap: spacing.xs },
    deviceTitle: { fontSize: fontSize.md, fontWeight: '700' },
    deviceSummary: { fontSize: fontSize.sm, lineHeight: 20 },
    deviceMeta: { fontSize: fontSize.xs },
    importButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderStyle: 'dashed', gap: spacing.sm },
    importText: { fontSize: fontSize.md, fontWeight: '500' },
    modeGrid: { gap: spacing.sm, marginTop: spacing.md },
    modeCard: { borderWidth: 1, borderRadius: borderRadius.lg, padding: spacing.md, gap: spacing.xs },
    modeHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    modeLabel: { fontSize: fontSize.md, fontWeight: '700' },
    modeDescription: { fontSize: fontSize.sm, lineHeight: 20 },
    modeMeta: { fontSize: fontSize.xs, fontWeight: '600', marginTop: spacing.xs },
    list: { padding: spacing.lg, gap: spacing.md },
    card: { padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
    modelInfo: { flex: 1 },
    modelName: { fontSize: fontSize.lg, fontWeight: '600' },
    modelSize: { fontSize: fontSize.sm, marginTop: spacing.xs },
    badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: borderRadius.full, gap: spacing.xs },
    badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
    description: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing.md },
    advice: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, gap: spacing.xs, marginBottom: spacing.md },
    adviceHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    adviceLabel: { fontSize: fontSize.sm, fontWeight: '700' },
    adviceText: { fontSize: fontSize.sm, lineHeight: 18 },
    adviceMeta: { fontSize: fontSize.xs, lineHeight: 16 },
    progressContainer: { marginBottom: spacing.md },
    progressBar: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: spacing.xs },
    progressFill: { height: '100%' },
    progressText: { fontSize: fontSize.xs, textAlign: 'right' },
    cardActions: { flexDirection: 'row', gap: spacing.sm },
    button: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: spacing.sm, borderRadius: borderRadius.md, gap: spacing.xs },
    buttonOutline: { backgroundColor: 'transparent', borderWidth: 1 },
    buttonText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '600' },
    buttonTextOutline: { fontSize: fontSize.sm, fontWeight: '600' },
    iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md },
});
