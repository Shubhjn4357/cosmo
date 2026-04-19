/**
 * Cosmo App - ChatInput Component (Gemini Style)
 */
import React, { useState, useRef } from 'react';
import {
    View,
    TextInput,
    TouchableOpacity,
    Text,
    StyleSheet,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, fontSize } from '@/constants/theme';
import { InteractiveButton } from '@/components/InteractiveButton';
import { getModelModeLabel } from '@/hooks/useAIRuntime';
// Import your types
import { ModelType, SelectedFile } from '@/types';

interface ChatInputProps {
    inputText: string;
    isLoading: boolean;
    isStreaming?: boolean;
    useModel: ModelType;
    selectedFile: SelectedFile | null;
    enterToSend?: boolean;
    onChangeText: (text: string) => void;
    onSend: () => void;
    onStopGeneration?: () => void;
    onModelSwitch: () => void;
    pickFromCamera: () => void;
    onFilePick: () => void;
    onFileRemove: () => void;
    formatFileSize: (bytes?: number) => string;
    createImageMode: boolean;
    setCreateImageMode: (value: boolean) => void;
    // Voice input props
    onVoiceInput?: () => void;
    isRecording?: boolean;
    isTranscribing?: boolean;
}

export function ChatInput({
    inputText,
    isLoading,
    isStreaming = false,
    useModel,
    selectedFile,
    enterToSend = true,
    onChangeText,
    onSend,
    onStopGeneration,
    pickFromCamera,
    onModelSwitch,
    onFilePick,
    onFileRemove,
    formatFileSize,
    onVoiceInput,
    isRecording = false,
    isTranscribing = false,
    createImageMode,
    setCreateImageMode,
}: ChatInputProps) {
    const { theme, isDark } = useTheme();
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<TextInput>(null);

    const handleKeyPress = (e: any) => {
        if (enterToSend && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
            e.preventDefault?.();
            onSend();
        }
    };

    const handleSend = () => {
        onSend();
    };

    const canSend = (!!inputText.trim() || !!selectedFile) && !isLoading;
    const modeLabel = getModelModeLabel(useModel);
    const nextModeTooltip =
        useModel === 'cloud'
            ? 'Switch to Server'
            : useModel === 'server'
                ? 'Switch to Self-Learner'
                : useModel === 'self-learner'
                    ? 'Switch to Local'
                    : 'Switch to Cloud';

    return (
        <View style={styles.container}>

            <View style={[
                styles.inputContainer,
                {
                    backgroundColor: isDark ? '#1E1E1E' : '#F5F5F5',
                    borderTopColor: isFocused ? theme.colors.primary + '50' : 'transparent',
                    borderRightColor:isFocused ? theme.colors.primary + '50' : 'transparent',
                    borderLeftColor:isFocused ? theme.colors.primary + '50' : 'transparent',
                }
            ]}>
            {/* File Preview */}
            {selectedFile && (
                <View style={[
                    styles.filePreview,
                    {
                        backgroundColor: isDark ? 'rgba(40,40,45,0.95)' : 'rgba(255,255,255,0.95)',
                        borderColor: theme.colors.surfaceBorder,
                    }
                ]}>
                    <View style={[styles.fileIconCircle, { backgroundColor: theme.colors.primary + '20' }]}>
                        <Ionicons name="document-attach" size={14} color={theme.colors.primary} />
                    </View>
                    <Text style={[styles.filePreviewText, { color: theme.colors.text }]} numberOfLines={1}>
                        {selectedFile.name}
                    </Text>
                    <Text style={[styles.filePreviewSize, { color: theme.colors.textMuted }]}>
                        {formatFileSize(selectedFile.size)}
                    </Text>
                    <TouchableOpacity onPress={onFileRemove} style={styles.fileRemoveBtn}>
                        <Ionicons name="close-circle" size={24} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                </View>
            )}
                {createImageMode && (
                    <View style={[styles.imageModePill, { backgroundColor: theme.colors.primary + '20' }]}>
                        <Ionicons name="sparkles" size={14} color={theme.colors.primary} />
                        <Text style={[styles.imageModePillText, { color: theme.colors.primary }]}>
                            Create Image
                        </Text>
                        <TouchableOpacity onPress={() => setCreateImageMode(false)}>
                            <Ionicons name="close-circle" size={24} color={theme.colors.primary} />
                        </TouchableOpacity>
                    </View>
                )}

                <TextInput
                    ref={inputRef}
                    style={[styles.input, { color: theme.colors.text }]}
                    value={inputText}
                    onChangeText={onChangeText}
                    placeholder="Ask Cosmo"
                    placeholderTextColor={theme.colors.textMuted}
                    multiline
                    maxLength={2000}
                    onKeyPress={handleKeyPress}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                />

                <View style={styles.bottomRow}>
                    <View style={styles.leftIcons}>
                        <InteractiveButton
                            onPress={pickFromCamera} 
                            tooltip="Add File"
                            style={styles.iconBtn} 
                        >
                            <Ionicons name="add" size={24} color={theme.colors.textMuted} />
                        </InteractiveButton>

                        {/* Voice Input Button */}
                        {onVoiceInput && (
                            <InteractiveButton
                                onPress={onVoiceInput}
                                tooltip={isRecording ? "Recording..." : isTranscribing ? "Transcribing..." : "Voice Input"}
                                style={[
                                    styles.iconBtn,
                                    isRecording && { backgroundColor: theme.colors.error + '20' }
                                ]}
                            >
                                {isRecording ? (
                                    <Ionicons name="stop-circle" size={24} color={theme.colors.error} />
                                ) : isTranscribing ? (
                                    <Ionicons name="hourglass" size={20} color={theme.colors.primary} />
                                ) : (
                                    <Ionicons name="mic" size={20} color={theme.colors.textMuted} />
                                )}
                            </InteractiveButton>
                        )}

                        <InteractiveButton
                            onPress={onFilePick} 
                            tooltip="Options"
                            style={styles.iconBtn} 
                        >
                            <Ionicons name="options-outline" size={20} color={theme.colors.textMuted} />
                        </InteractiveButton>
                    </View>
                    <View style={styles.rightIcons}>
                        <InteractiveButton
                            onPress={onModelSwitch} 
                            tooltip={nextModeTooltip}
                            style={[styles.modelPill, { backgroundColor: isDark ? '#2A2A2A' : '#E5E5E5' }]} 
                        >
                            <Text style={[styles.modelPillText, { color: theme.colors.text }]}>
                                {modeLabel}
                            </Text>
                        </InteractiveButton>

                        <InteractiveButton
                            onPress={isStreaming ? (onStopGeneration || (() => { })) : handleSend}
                            disabled={!canSend && !isStreaming}
                            tooltip={isStreaming ? "Stop Generation" : "Send Message"}
                            style={[styles.sendBtn, { backgroundColor: (canSend || isStreaming) ? theme.colors.primary : 'transparent' }]}
                        >
                            <Ionicons
                                name={isStreaming ? "stop" : "arrow-up"}
                                size={20}
                                color={(canSend || isStreaming) ? '#fff' : theme.colors.textMuted}
                            />
                        </InteractiveButton>
                    </View>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    filePreview: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 8,
        marginHorizontal: 16, // Added margin to align with input
    },
    fileIconCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    filePreviewText: { flex: 1, fontSize: 13, fontWeight: '500' },
    filePreviewSize: { fontSize: 11 },
    fileRemoveBtn: { padding: 2 },
    inputContainer: {
        borderTopLeftRadius: 32, // Adjusted for cleaner look
        borderTopRightRadius: 32,
        paddingHorizontal: 24,
        paddingTop: 24,
        // Reduced bottom padding because SafeAreaView/KAV handles the bottom space now
        paddingBottom: 24,
        borderWidth: 1,
    },
    input: {
        fontSize: 16,
        lineHeight: 22,
        minHeight: 24,
        maxHeight: 160,
        paddingVertical: 0, // Reset padding
        marginBottom: 16,
    },
    bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    leftIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    rightIcons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    modelPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
    modelPillText: { fontSize: 13, fontWeight: '600' },
    sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    imageModePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 20, gap: spacing.xs, marginBottom: spacing.md },
    imageModePillText: { fontSize: fontSize.sm, fontWeight: '600' },
});

export default ChatInput;
