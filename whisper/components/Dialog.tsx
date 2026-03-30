/**
 * Whisper App - Confirmation Dialog Component
 * Beautiful modal dialog for confirmations and options
 * 
 * Usage:
 *   import { useDialog } from '@/components/Dialog';
 *   
 *   const dialog = useDialog();
 *   
 *   dialog.confirm({
 *     title: 'Delete Model',
 *     message: 'Are you sure?',
 *     confirmText: 'Delete',
 *     confirmStyle: 'destructive',
 *     onConfirm: () => deleteModel(),
 *   });
 *   
 *   dialog.options({
 *     title: 'Model Name',
 *     message: 'What would you like to do?',
 *     options: [
 *       { text: 'Load', onPress: () => loadModel() },
 *       { text: 'Delete', style: 'destructive', onPress: () => deleteModel() },
 *     ],
 *   });
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
    TouchableOpacity,
    Modal,
    Dimensions,
    TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type OptionStyle = 'default' | 'cancel' | 'destructive';

interface DialogOption {
    text: string;
    style?: OptionStyle;
    onPress?: () => void;
}

interface ConfirmConfig {
    title: string;
    message?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    confirmText?: string;
    cancelText?: string;
    confirmStyle?: OptionStyle;
    onConfirm?: () => void;
    onCancel?: () => void;
}

interface OptionsConfig {
    title: string;
    message?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    options: DialogOption[];
    cancelText?: string;
    onCancel?: () => void;
}

interface AlertConfig {
    title: string;
    message?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    buttonText?: string;
    onDismiss?: () => void;
}

interface DialogContextType {
    confirm: (config: ConfirmConfig) => void;
    options: (config: OptionsConfig) => void;
    alert: (config: AlertConfig) => void;
    dismiss: () => void;
}

const DialogContext = createContext<DialogContextType | null>(null);

function DialogContent({
    config,
    onDismiss,
}: {
    config: ConfirmConfig | OptionsConfig | AlertConfig | null;
    onDismiss: () => void;
}) {
    const { theme, isDark } = useTheme();
    const scaleAnim = useRef(new Animated.Value(0.9)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (config) {
            Animated.parallel([
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    useNativeDriver: true,
                    tension: 65,
                    friction: 8,
                }),
                Animated.timing(opacityAnim, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [config]);

    const animateOut = (callback?: () => void) => {
        Animated.parallel([
            Animated.timing(scaleAnim, {
                toValue: 0.9,
                duration: 150,
                useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true,
            }),
        ]).start(() => {
            callback?.();
            onDismiss();
        });
    };

    const getButtonStyle = (style?: OptionStyle) => {
        switch (style) {
            case 'destructive':
                return { backgroundColor: '#ef4444' };
            case 'cancel':
                return { backgroundColor: theme.colors.surfaceLight };
            default:
                return { backgroundColor: theme.colors.primary };
        }
    };

    const getButtonTextColor = (style?: OptionStyle) => {
        return style === 'cancel' ? theme.colors.text : '#fff';
    };

    if (!config) return null;

    // Type guards
    const isConfirm = 'confirmText' in config || ('onConfirm' in config && !('options' in config));
    const isOptions = 'options' in config;

    return (
        <Modal transparent visible={!!config} animationType="none" onRequestClose={() => animateOut()}>
            <TouchableWithoutFeedback onPress={() => animateOut()}>
                <View style={styles.overlay}>
                    <BlurView intensity={30} style={StyleSheet.absoluteFill} tint={isDark ? 'dark' : 'light'} />
                    <TouchableWithoutFeedback>
                        <Animated.View
                            style={[
                                styles.dialog,
                                {
                                    backgroundColor: isDark ? 'rgba(30, 30, 40, 0.98)' : 'rgba(255, 255, 255, 0.98)',
                                    borderColor: theme.colors.surfaceBorder,
                                    transform: [{ scale: scaleAnim }],
                                    opacity: opacityAnim,
                                },
                            ]}
                        >
                            {/* Icon */}
                            {config.icon && (
                                <View style={[styles.iconContainer, { backgroundColor: (config.iconColor || theme.colors.primary) + '20' }]}>
                                    <Ionicons name={config.icon} size={32} color={config.iconColor || theme.colors.primary} />
                                </View>
                            )}

                            {/* Title */}
                            <Text style={[styles.title, { color: theme.colors.text }]}>{config.title}</Text>

                            {/* Message */}
                            {config.message && (
                                <Text style={[styles.message, { color: theme.colors.textMuted }]}>{config.message}</Text>
                            )}

                            {/* Buttons */}
                            <View style={styles.buttonContainer}>
                                {isOptions ? (
                                    // Options dialog
                                    <>
                                        {(config as OptionsConfig).options.map((option, index) => (
                                            <TouchableOpacity
                                                key={index}
                                                style={[styles.button, getButtonStyle(option.style)]}
                                                onPress={() => animateOut(option.onPress)}
                                            >
                                                <Text style={[styles.buttonText, { color: getButtonTextColor(option.style) }]}>
                                                    {option.text}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                        <TouchableOpacity
                                            style={[styles.button, getButtonStyle('cancel')]}
                                            onPress={() => animateOut((config as OptionsConfig).onCancel)}
                                        >
                                            <Text style={[styles.buttonText, { color: getButtonTextColor('cancel') }]}>
                                                {(config as OptionsConfig).cancelText || 'Cancel'}
                                            </Text>
                                        </TouchableOpacity>
                                    </>
                                ) : isConfirm ? (
                                    // Confirm dialog
                                    <View style={styles.confirmButtons}>
                                        <TouchableOpacity
                                            style={[styles.button, styles.halfButton, getButtonStyle('cancel')]}
                                            onPress={() => animateOut((config as ConfirmConfig).onCancel)}
                                        >
                                            <Text style={[styles.buttonText, { color: getButtonTextColor('cancel') }]}>
                                                {(config as ConfirmConfig).cancelText || 'Cancel'}
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.button, styles.halfButton, getButtonStyle((config as ConfirmConfig).confirmStyle)]}
                                            onPress={() => animateOut((config as ConfirmConfig).onConfirm)}
                                        >
                                            <Text style={[styles.buttonText, { color: getButtonTextColor((config as ConfirmConfig).confirmStyle) }]}>
                                                {(config as ConfirmConfig).confirmText || 'Confirm'}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                ) : (
                                    // Alert dialog
                                    <TouchableOpacity
                                        style={[styles.button, getButtonStyle('default')]}
                                        onPress={() => animateOut((config as AlertConfig).onDismiss)}
                                    >
                                        <Text style={[styles.buttonText, { color: '#fff' }]}>
                                            {(config as AlertConfig).buttonText || 'OK'}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </Animated.View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
    const [config, setConfig] = useState<ConfirmConfig | OptionsConfig | AlertConfig | null>(null);

    const confirm = useCallback((cfg: ConfirmConfig) => {
        setConfig(cfg);
    }, []);

    const options = useCallback((cfg: OptionsConfig) => {
        setConfig(cfg);
    }, []);

    const alert = useCallback((cfg: AlertConfig) => {
        setConfig(cfg);
    }, []);

    const dismiss = useCallback(() => {
        setConfig(null);
    }, []);

    const contextValue: DialogContextType = {
        confirm,
        options,
        alert,
        dismiss,
    };

    return (
        <DialogContext.Provider value={contextValue}>
            {children}
            <DialogContent config={config} onDismiss={dismiss} />
        </DialogContext.Provider>
    );
}

export function useDialog(): DialogContextType {
    const context = useContext(DialogContext);
    if (!context) {
        throw new Error('useDialog must be used within a DialogProvider');
    }
    return context;
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
    },
    dialog: {
        width: '100%',
        maxWidth: 340,
        borderRadius: borderRadius.xl,
        borderWidth: 1,
        padding: spacing.lg,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 20,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        marginBottom: spacing.md,
    },
    title: {
        fontSize: fontSize.lg,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: spacing.sm,
    },
    message: {
        fontSize: fontSize.md,
        textAlign: 'center',
        marginBottom: spacing.lg,
        lineHeight: 22,
    },
    buttonContainer: {
        gap: spacing.sm,
    },
    confirmButtons: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    button: {
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    halfButton: {
        flex: 1,
    },
    buttonText: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
});

export default DialogProvider;
