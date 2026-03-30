
import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

interface ServerModel {
    id: string;
    name: string;
    type?: string;
}

interface ModelPickerModalProps {
    visible: boolean;
    onClose: () => void;
    serverModels: ServerModel[];
    localModels: any[]; // Keep for compatibility but ignore
    selectedModelId: string;
    onSelectModel: (id: string) => void;
    useLocal: boolean; // Keep for compatibility but ignore
    onToggleLocal: (value: boolean) => void; // Keep for compatibility but ignore
    downloadedModels: string[]; // Keep for compatibility but ignore
    showDownloadOptions?: boolean; // Keep for compatibility but ignore
}

export function ModelPickerModal({
    visible,
    onClose,
    serverModels,
    selectedModelId,
    onSelectModel,
}: ModelPickerModalProps) {
    const { theme } = useTheme();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>Select AI Horde Model</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Ionicons name="close" size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                </View>

                <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: spacing.xl }}>
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>CLOUD MODELS</Text>
                        {serverModels.map((model) => {
                            const isSelected = selectedModelId === model.id;
                            return (
                                <TouchableOpacity
                                    key={model.id}
                                    style={[
                                        styles.modelItem,
                                        {
                                            backgroundColor: theme.colors.surface,
                                            borderColor: isSelected ? theme.colors.primary : theme.colors.surfaceBorder
                                        }
                                    ]}
                                    onPress={() => {
                                        onSelectModel(model.id);
                                        onClose();
                                    }}
                                >
                                    <View style={styles.modelInfo}>
                                        <View style={styles.modelHeader}>
                                            <Text style={[styles.modelName, { color: theme.colors.text }]}>{model.name}</Text>
                                            {model.type && (
                                                <View style={[styles.badge, { backgroundColor: '#3b82f620' }]}>
                                                    <Text style={[styles.badgeText, { color: '#3b82f6' }]}>{model.type}</Text>
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                    {isSelected && (
                                        <Ionicons name="checkmark-circle" size={24} color={theme.colors.primary} />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </ScrollView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        marginTop: 60,
        borderTopLeftRadius: borderRadius.xl,
        borderTopRightRadius: borderRadius.xl,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    title: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    closeButton: {
        padding: spacing.xs,
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.lg,
    },
    section: {
        gap: spacing.md,
        marginTop: spacing.md,
    },
    sectionTitle: {
        fontSize: fontSize.xs,
        fontWeight: '700',
        letterSpacing: 1,
        marginTop: spacing.sm,
    },
    modelItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        gap: spacing.md,
    },
    modelInfo: {
        flex: 1,
    },
    modelHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    modelName: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
});
