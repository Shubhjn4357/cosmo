/**
 * Whisper App - FilePickerModal Component
 * Modal for selecting file type to upload
 */

import React from 'react';
import { View, Text, TouchableOpacity, Modal, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { FileTypeOption } from '@/types';

interface FilePickerModalProps {
    visible: boolean;
    options: FileTypeOption[];
    onClose: () => void;
    onSelect: (types: string[]) => void;
}

export function FilePickerModal({ visible, options, onClose, onSelect }: FilePickerModalProps) {
    const { theme } = useTheme();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={[styles.content, { backgroundColor: theme.colors.surface }]}>
                            <Text style={[styles.title, { color: theme.colors.text }]}>Attach File</Text>
                            <View style={styles.options}>
                                {options.map((option, index) => (
                                    <TouchableOpacity
                                        key={index}
                                        style={[styles.option, { backgroundColor: theme.colors.surfaceLight }]}
                                        onPress={() => onSelect(option.types)}
                                    >
                                        <View style={[styles.optionIcon, { backgroundColor: theme.colors.primary + '20' }]}>
                                            <Ionicons name={option.icon as any} size={24} color={theme.colors.primary} />
                                        </View>
                                        <Text style={[styles.optionText, { color: theme.colors.text }]}>{option.label}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <TouchableOpacity
                                style={[styles.cancel, { borderTopColor: theme.colors.surfaceBorder }]}
                                onPress={onClose}
                            >
                                <Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>Cancel</Text>
                            </TouchableOpacity>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        borderRadius: borderRadius.xl,
        padding: spacing.lg,
        width: '80%',
        maxWidth: 320,
    },
    title: {
        fontSize: fontSize.lg,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: spacing.lg,
    },
    options: {
        gap: spacing.md,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: borderRadius.md,
    },
    optionIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    optionText: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    cancel: {
        borderTopWidth: 1,
        marginTop: spacing.lg,
        paddingTop: spacing.md,
    },
    cancelText: {
        textAlign: 'center',
        fontSize: fontSize.md,
    },
});

export default FilePickerModal;
