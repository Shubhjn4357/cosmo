import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { whisperAPI, FileReadResponse, FileAnalyzeResponse } from '@/services/api';

interface SelectedFile {
    uri: string;
    name: string;
    type?: string;
    size?: number;
}

export default function FilesScreen() {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
    const [fileContent, setFileContent] = useState<FileReadResponse | null>(null);
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState<FileAnalyzeResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const pickDocument = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['application/pdf', 'text/*', 'image/*', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
                copyToCacheDirectory: true,
            });

            if (!result.canceled && result.assets[0]) {
                const asset = result.assets[0];
                setSelectedFile({
                    uri: asset.uri,
                    name: asset.name,
                    type: asset.mimeType,
                    size: asset.size,
                });
                setFileContent(null);
                setAnswer(null);
                setError(null);
            }
        } catch (err) {
            setError('Failed to pick document');
        }
    };

    const readFile = async () => {
        if (!selectedFile || isLoading) return;
        setIsLoading(true);
        setError(null);

        try {
            const result = await whisperAPI.readFile(selectedFile);
            setFileContent(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to read file');
        } finally {
            setIsLoading(false);
        }
    };

    const analyzeFile = async () => {
        if (!selectedFile || !question.trim() || isAnalyzing) return;
        setIsAnalyzing(true);
        setError(null);

        try {
            const result = await whisperAPI.analyzeFile(selectedFile, question);
            setAnswer(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to analyze file');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return 'Unknown size';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const bottomPadding = 60 + Math.max(insets.bottom, 10) + spacing.xl;

    return (
        <View style={[styles.container, { backgroundColor: isDark ? theme.colors.background : theme.colors.background }]}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <ScrollView 
                    style={styles.scrollView} 
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: bottomPadding }}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Files</Text>
                        <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>
                            Upload and analyze documents
                        </Text>
                    </View>

                    {/* File Picker */}
                    <View style={styles.section}>
                        <TouchableOpacity 
                            style={[styles.uploadButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]} 
                            onPress={pickDocument}
                        >
                            <Ionicons name="cloud-upload-outline" size={32} color={theme.colors.primary} />
                            <Text style={[styles.uploadTitle, { color: theme.colors.text }]}>Select a File</Text>
                            <Text style={[styles.uploadSubtitle, { color: theme.colors.textMuted }]}>PDF, TXT, DOCX, or Image</Text>
                        </TouchableOpacity>

                        {selectedFile && (
                            <View style={[styles.fileCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                                <View style={[styles.fileIcon, { backgroundColor: theme.colors.accent + '20' }]}>
                                    <Ionicons name="document" size={24} color={theme.colors.accent} />
                                </View>
                                <View style={styles.fileInfo}>
                                    <Text style={[styles.fileName, { color: theme.colors.text }]} numberOfLines={1}>
                                        {selectedFile.name}
                                    </Text>
                                    <Text style={[styles.fileSize, { color: theme.colors.textMuted }]}>
                                        {formatFileSize(selectedFile.size)}
                                    </Text>
                                </View>
                                <TouchableOpacity onPress={() => setSelectedFile(null)}>
                                    <Ionicons name="close-circle" size={24} color={theme.colors.textMuted} />
                                </TouchableOpacity>
                            </View>
                        )}

                        {selectedFile && !fileContent && (
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: theme.colors.primary }, isLoading && styles.actionButtonDisabled]}
                                onPress={readFile}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <>
                                        <Ionicons name="document-text-outline" size={20} color="#fff" />
                                        <Text style={styles.actionButtonText}>Extract Text</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Extracted Content */}
                    {fileContent && (
                        <View style={styles.section}>
                            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Extracted Content</Text>
                            <View style={styles.statsRow}>
                                <View style={[styles.statItem, { backgroundColor: theme.colors.surface }]}>
                                    <Text style={[styles.statValue, { color: theme.colors.primary }]}>{fileContent.word_count}</Text>
                                    <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>Words</Text>
                                </View>
                                <View style={[styles.statItem, { backgroundColor: theme.colors.surface }]}>
                                    <Text style={[styles.statValue, { color: theme.colors.primary }]}>{fileContent.pages || '-'}</Text>
                                    <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>Pages</Text>
                                </View>
                            </View>
                            <View style={[styles.contentBox, { backgroundColor: theme.colors.surface }]}>
                                <Text style={[styles.contentText, { color: theme.colors.textSecondary }]} numberOfLines={10}>
                                    {fileContent.content}
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* Question & Answer */}
                    {fileContent && (
                        <View style={styles.section}>
                            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Ask About This File</Text>
                            <TextInput
                                style={[styles.questionInput, { color: theme.colors.text, backgroundColor: theme.colors.surface }]}
                                value={question}
                                onChangeText={setQuestion}
                                placeholder="What is the main topic of this document?"
                                placeholderTextColor={theme.colors.textMuted}
                                multiline
                            />
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: theme.colors.accent }, (!question.trim() || isAnalyzing) && styles.actionButtonDisabled]}
                                onPress={analyzeFile}
                                disabled={!question.trim() || isAnalyzing}
                            >
                                {isAnalyzing ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <>
                                        <Ionicons name="sparkles" size={20} color="#fff" />
                                        <Text style={styles.actionButtonText}>Analyze</Text>
                                    </>
                                )}
                            </TouchableOpacity>

                            {answer && (
                                <View style={[styles.answerBox, { backgroundColor: theme.colors.aiBubble, borderColor: theme.colors.surfaceBorder }]}>
                                    <View style={styles.answerHeader}>
                                        <Ionicons name="sparkles" size={16} color={theme.colors.accent} />
                                        <Text style={[styles.answerLabel, { color: theme.colors.accent }]}>Whisper's Answer</Text>
                                    </View>
                                    <Text style={[styles.answerText, { color: theme.colors.text }]}>{answer.answer}</Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Error */}
                    {error && (
                        <View style={[styles.errorContainer, { backgroundColor: theme.colors.error + '20' }]}>
                            <Ionicons name="alert-circle" size={24} color={theme.colors.error} />
                            <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
                        </View>
                    )}
                </ScrollView>
            </SafeAreaView>
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
    section: {
        paddingHorizontal: spacing.lg,
        marginBottom: spacing.xl,
        gap: spacing.md,
    },
    sectionTitle: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    uploadButton: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        borderRadius: borderRadius.lg,
        borderWidth: 2,
        borderStyle: 'dashed',
        gap: spacing.sm,
    },
    uploadTitle: {
        fontSize: fontSize.lg,
        fontWeight: '600',
    },
    uploadSubtitle: {
        fontSize: fontSize.sm,
    },
    fileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        gap: spacing.md,
    },
    fileIcon: {
        width: 48,
        height: 48,
        borderRadius: borderRadius.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fileInfo: {
        flex: 1,
    },
    fileName: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    fileSize: {
        fontSize: fontSize.sm,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
    },
    actionButtonDisabled: {
        opacity: 0.5,
    },
    actionButtonText: {
        fontSize: fontSize.md,
        fontWeight: '600',
        color: '#fff',
    },
    statsRow: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.md,
    },
    statValue: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    statLabel: {
        fontSize: fontSize.xs,
        marginTop: spacing.xs,
    },
    contentBox: {
        padding: spacing.md,
        borderRadius: borderRadius.md,
    },
    contentText: {
        fontSize: fontSize.sm,
        lineHeight: 22,
    },
    questionInput: {
        minHeight: 80,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        fontSize: fontSize.md,
        textAlignVertical: 'top',
    },
    answerBox: {
        padding: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        gap: spacing.sm,
    },
    answerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    answerLabel: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
    answerText: {
        fontSize: fontSize.md,
        lineHeight: 24,
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        margin: spacing.lg,
        padding: spacing.md,
        borderRadius: borderRadius.md,
    },
    errorText: {
        flex: 1,
        fontSize: fontSize.sm,
    },
});
