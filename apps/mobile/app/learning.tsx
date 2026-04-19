/**
 * Learning System Screen
 * View AI learning statistics and submit training data
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    TextInput,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { cosmoAPI } from '@/services/api';
import { useAuth } from '@/hooks';
import { useToast } from '@/components/Toast';

export default function LearningScreen() {
    const { theme, isDark } = useTheme();
    const router = useRouter();
    const { user } = useAuth();
    const toast = useToast();

    const [stats, setStats] = useState<{
        total_training_pairs: number;
        external_model_pairs: number;
        total_knowledge: number;
        learning_enabled: boolean;
        restrictions: string;
        content_filter: string;
        huggingface_repo: string;
        hf_sync_enabled: boolean;
        last_sync_count: number;
        pending_sync: number;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    // Training data form
    const [inputText, setInputText] = useState('');
    const [outputText, setOutputText] = useState('');
    const [modelName, setModelName] = useState('user-feedback');

    useEffect(() => {
        loadStats();
    }, []);

    const loadStats = async () => {
        try {
            setLoading(true);
            const data = await cosmoAPI.getLearningStats();
            setStats(data);
        } catch (error) {
            console.error('Failed to load stats:', error);
            toast.error('Error', 'Failed to load learning statistics');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!inputText.trim() || !outputText.trim()) {
            Alert.alert('Validation Error', 'Please fill in both input and expected output');
            return;
        }

        try {
            setSubmitting(true);
            await cosmoAPI.submitTrainingData({
                input: inputText,
                output: outputText,
                model: modelName,
                userId: user?.id,
            });

            toast.success('Submitted', 'Training data added to learning system');
            setInputText('');
            setOutputText('');
            await loadStats(); // Refresh stats
        } catch (error: any) {
            console.error('Submit error:', error);
            toast.error('Error', error.message || 'Failed to submit training data');
        } finally {
            setSubmitting(false);
        }
    };

    const StatCard = ({ icon, label, value, color }: {
        icon: string;
        label: string;
        value: string | number;
        color: string;
    }) => (
        <View style={[styles.statCard, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.statIcon, { backgroundColor: color + '20' }]}>
                <Ionicons name={icon as any} size={28} color={color} />
            </View>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
        </View>
    );

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                    <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                        Loading statistics...
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                    AI Learning
                </Text>
                <TouchableOpacity onPress={loadStats} style={styles.refreshButton}>
                    <Ionicons name="refresh" size={24} color={theme.colors.primary} />
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Info Banner */}
                <View style={[styles.infoBanner, { backgroundColor: theme.colors.primary + '15' }]}>
                    <Ionicons name="sparkles" size={24} color={theme.colors.primary} />
                    <View style={styles.infoText}>
                        <Text style={[styles.infoTitle, { color: theme.colors.text }]}>
                            Help Train Cosmo AI
                        </Text>
                        <Text style={[styles.infoSubtitle, { color: theme.colors.textSecondary }]}>
                            Your feedback helps improve AI responses for everyone
                        </Text>
                    </View>
                </View>

                {/* Statistics */}
                {stats && (
                    <View style={styles.statsContainer}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                            Learning Statistics
                        </Text>
                        <View style={styles.statsGrid}>
                            <StatCard
                                icon="library"
                                label="Training Pairs"
                                value={stats.total_training_pairs.toLocaleString()}
                                color={theme.colors.primary}
                            />
                            <StatCard
                                icon="cube"
                                label="External Pairs"
                                value={stats.external_model_pairs}
                                color={theme.colors.success}
                            />
                        </View>

                        {/* HuggingFace Sync Info */}
                        {stats.hf_sync_enabled && (
                            <View style={[styles.hfSyncCard, { backgroundColor: theme.colors.surface }]}>
                                <View style={styles.hfSyncHeader}>
                                    <Ionicons name="cloud-upload" size={20} color={theme.colors.primary} />
                                    <Text style={[styles.hfSyncTitle, { color: theme.colors.text }]}>
                                        HuggingFace Sync
                                    </Text>
                                </View>
                                <Text style={[styles.hfSyncRepo, { color: theme.colors.textSecondary }]}>
                                    📦 {stats.huggingface_repo}
                                </Text>
                                <Text style={[styles.hfSyncStatus, { color: theme.colors.textMuted }]}>
                                    Last sync: {stats.last_sync_count} pairs • Pending: {stats.pending_sync}
                                </Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Submit Training Data */}
                <View style={styles.formContainer}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        Submit Training Data
                    </Text>
                    <Text style={[styles.formDescription, { color: theme.colors.textSecondary }]}>
                        Teach the AI by providing examples of inputs and expected outputs
                    </Text>

                    <View style={styles.form}>
                        <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: theme.colors.text }]}>
                                Input Prompt
                            </Text>
                            <TextInput
                                style={[
                                    styles.input,
                                    styles.multilineInput,
                                    {
                                        backgroundColor: isDark ? '#1E1E1E' : '#F5F5F5',
                                        color: theme.colors.text,
                                        borderColor: theme.colors.surfaceBorder,
                                    }
                                ]}
                                value={inputText}
                                onChangeText={setInputText}
                                placeholder="What the user asks..."
                                placeholderTextColor={theme.colors.textMuted}
                                multiline
                                numberOfLines={3}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: theme.colors.text }]}>
                                Expected Output
                            </Text>
                            <TextInput
                                style={[
                                    styles.input,
                                    styles.multilineInput,
                                    {
                                        backgroundColor: isDark ? '#1E1E1E' : '#F5F5F5',
                                        color: theme.colors.text,
                                        borderColor: theme.colors.surfaceBorder,
                                    }
                                ]}
                                value={outputText}
                                onChangeText={setOutputText}
                                placeholder="What the AI should respond..."
                                placeholderTextColor={theme.colors.textMuted}
                                multiline
                                numberOfLines={4}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: theme.colors.text }]}>
                                Model Category
                            </Text>
                            <TextInput
                                style={[
                                    styles.input,
                                    {
                                        backgroundColor: isDark ? '#1E1E1E' : '#F5F5F5',
                                        color: theme.colors.text,
                                        borderColor: theme.colors.surfaceBorder,
                                    }
                                ]}
                                value={modelName}
                                onChangeText={setModelName}
                                placeholder="e.g., general, code, creative"
                                placeholderTextColor={theme.colors.textMuted}
                            />
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.submitButton,
                                {
                                    backgroundColor: theme.colors.primary,
                                    opacity: (!inputText.trim() || !outputText.trim() || submitting) ? 0.5 : 1,
                                }
                            ]}
                            onPress={handleSubmit}
                            disabled={!inputText.trim() || !outputText.trim() || submitting}
                        >
                            {submitting ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="send" size={20} color="#fff" />
                                    <Text style={styles.submitButtonText}>Submit Training Data</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>

                {/* How it works */}
                <View style={[styles.howItWorks, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        How It Works
                    </Text>
                    <View style={styles.step}>
                        <View style={[styles.stepNumber, { backgroundColor: theme.colors.primary }]}>
                            <Text style={styles.stepNumberText}>1</Text>
                        </View>
                        <Text style={[styles.stepText, { color: theme.colors.text }]}>
                            You provide examples of good AI responses
                        </Text>
                    </View>
                    <View style={styles.step}>
                        <View style={[styles.stepNumber, { backgroundColor: theme.colors.primary }]}>
                            <Text style={styles.stepNumberText}>2</Text>
                        </View>
                        <Text style={[styles.stepText, { color: theme.colors.text }]}>
                            The AI learns from patterns in the data
                        </Text>
                    </View>
                    <View style={styles.step}>
                        <View style={[styles.stepNumber, { backgroundColor: theme.colors.primary }]}>
                            <Text style={styles.stepNumberText}>3</Text>
                        </View>
                        <Text style={[styles.stepText, { color: theme.colors.text }]}>
                            Future responses improve for all users
                        </Text>
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: spacing.md,
    },
    loadingText: {
        fontSize: fontSize.md,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
    },
    backButton: {
        padding: spacing.xs,
    },
    refreshButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.lg,
    },
    infoBanner: {
        flexDirection: 'row',
        padding: spacing.lg,
        borderRadius: borderRadius.xl,
        gap: spacing.md,
        marginBottom: spacing.xl,
    },
    infoText: {
        flex: 1,
        gap: spacing.xs,
    },
    infoTitle: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    infoSubtitle: {
        fontSize: fontSize.sm,
        lineHeight: 18,
    },
    statsContainer: {
        marginBottom: spacing.xl,
    },
    sectionTitle: {
        fontSize: fontSize.xl,
        fontWeight: '700',
        marginBottom: spacing.md,
    },
    statsGrid: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    statCard: {
        flex: 1,
        padding: spacing.lg,
        borderRadius: borderRadius.xl,
        alignItems: 'center',
        gap: spacing.sm,
    },
    statIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: 'center',
        alignItems: 'center',
    },
    statValue: {
        fontSize: 32,
        fontWeight: '700',
    },
    statLabel: {
        fontSize: fontSize.sm,
        textAlign: 'center',
    },
    lastUpdated: {
        fontSize: fontSize.xs,
        textAlign: 'center',
        marginTop: spacing.md,
    },
    hfSyncCard: {
        marginTop: spacing.md,
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        gap: spacing.xs,
    },
    hfSyncHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    hfSyncTitle: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    hfSyncRepo: {
        fontSize: fontSize.sm,
    },
    hfSyncStatus: {
        fontSize: fontSize.xs,
    },
    formContainer: {
        marginBottom: spacing.xl,
    },
    formDescription: {
        fontSize: fontSize.sm,
        lineHeight: 20,
        marginBottom: spacing.lg,
    },
    form: {
        gap: spacing.lg,
    },
    inputGroup: {
        gap: spacing.sm,
    },
    label: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    input: {
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        fontSize: fontSize.md,
        borderWidth: 1,
    },
    multilineInput: {
        minHeight: 80,
        textAlignVertical: 'top',
    },
    submitButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.lg,
        borderRadius: borderRadius.xl,
        gap: spacing.sm,
    },
    submitButtonText: {
        color: '#fff',
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    howItWorks: {
        padding: spacing.lg,
        borderRadius: borderRadius.xl,
        marginBottom: spacing.xl,
        gap: spacing.md,
    },
    step: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    stepNumber: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stepNumberText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '700',
    },
    stepText: {
        flex: 1,
        fontSize: fontSize.md,
        lineHeight: 22,
    },
});
