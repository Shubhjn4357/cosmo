/**
 * Cosmo App - Toast Notification Component
 * Beautiful, animated toast notifications for better UX
 * 
 * Usage:
 *   import { useToast } from '@/components/Toast';
 *   
 *   const toast = useToast();
 *   toast.success('Download complete!');
 *   toast.error('Something went wrong');
 *   toast.info('Generating image...');
 *   toast.warning('Low storage space');
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
    TouchableOpacity,
    Dimensions,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Toast types
type ToastType = 'success' | 'error' | 'info' | 'warning' | 'loading';

interface ToastConfig {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
    action?: {
        label: string;
        onPress: () => void;
    };
    onDismiss?: () => void;
}

interface ToastContextType {
    show: (config: Omit<ToastConfig, 'id'>) => string;
    success: (title: string, message?: string, duration?: number) => string;
    error: (title: string, message?: string, duration?: number) => string;
    info: (title: string, message?: string, duration?: number) => string;
    warning: (title: string, message?: string, duration?: number) => string;
    loading: (title: string, message?: string) => string;
    dismiss: (id: string) => void;
    dismissAll: () => void;
    update: (id: string, config: Partial<Omit<ToastConfig, 'id'>>) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

// Toast item component
function ToastItem({ 
    toast, 
    onDismiss,
    index,
}: { 
    toast: ToastConfig;
    onDismiss: () => void;
    index: number;
}) {
    const { theme, isDark } = useTheme();
    const translateY = useRef(new Animated.Value(-100)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.9)).current;

    useEffect(() => {
        // Animate in
        Animated.parallel([
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 50,
                friction: 8,
            }),
            Animated.timing(opacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.spring(scale, {
                toValue: 1,
                useNativeDriver: true,
                tension: 50,
                friction: 8,
            }),
        ]).start();

        // Auto dismiss (except loading)
        if (toast.type !== 'loading' && toast.duration !== 0) {
            const timer = setTimeout(() => {
                animateOut();
            }, toast.duration || 4000);
            return () => clearTimeout(timer);
        }
    }, []);

    const animateOut = () => {
        Animated.parallel([
            Animated.timing(translateY, {
                toValue: -100,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }),
        ]).start(() => {
            onDismiss();
            toast.onDismiss?.();
        });
    };

    // Get colors and icon based on type
    const getTypeStyles = () => {
        switch (toast.type) {
            case 'success':
                return {
                    backgroundColor: isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
                    borderColor: '#22c55e',
                    iconColor: '#22c55e',
                    icon: 'checkmark-circle' as const,
                };
            case 'error':
                return {
                    backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)',
                    borderColor: '#ef4444',
                    iconColor: '#ef4444',
                    icon: 'alert-circle' as const,
                };
            case 'warning':
                return {
                    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.1)',
                    borderColor: '#f59e0b',
                    iconColor: '#f59e0b',
                    icon: 'warning' as const,
                };
            case 'loading':
                return {
                    backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                    borderColor: '#6366f1',
                    iconColor: '#6366f1',
                    icon: 'sync' as const,
                };
            case 'info':
            default:
                return {
                    backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)',
                    borderColor: '#3b82f6',
                    iconColor: '#3b82f6',
                    icon: 'information-circle' as const,
                };
        }
    };

    const typeStyles = getTypeStyles();

    // Loading spinner animation
    const spinAnim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (toast.type === 'loading') {
            Animated.loop(
                Animated.timing(spinAnim, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                })
            ).start();
        }
    }, [toast.type]);

    const spin = spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    return (
        <Animated.View
            style={[
                styles.toastContainer,
                {
                    backgroundColor: isDark ? 'rgba(30, 30, 40, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                    borderColor: typeStyles.borderColor,
                    transform: [{ translateY }, { scale }],
                    opacity,
                    marginTop: index > 0 ? spacing.sm : 0,
                },
            ]}
        >
            {/* Icon */}
            <View style={[styles.iconContainer, { backgroundColor: typeStyles.backgroundColor }]}>
                {toast.type === 'loading' ? (
                    <Animated.View style={{ transform: [{ rotate: spin }] }}>
                        <Ionicons name="sync" size={20} color={typeStyles.iconColor} />
                    </Animated.View>
                ) : (
                    <Ionicons name={typeStyles.icon} size={20} color={typeStyles.iconColor} />
                )}
            </View>

            {/* Content */}
            <View style={styles.content}>
                <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                    {toast.title}
                </Text>
                {toast.message && (
                    <Text style={[styles.message, { color: theme.colors.textMuted }]} numberOfLines={2}>
                        {toast.message}
                    </Text>
                )}
            </View>

            {/* Action button */}
            {toast.action && (
                <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: typeStyles.borderColor + '20' }]}
                    onPress={() => {
                        toast.action?.onPress();
                        animateOut();
                    }}
                >
                    <Text style={[styles.actionText, { color: typeStyles.borderColor }]}>
                        {toast.action.label}
                    </Text>
                </TouchableOpacity>
            )}

            {/* Dismiss button */}
            {toast.type !== 'loading' && (
                <TouchableOpacity
                    style={styles.dismissButton}
                    onPress={animateOut}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons name="close" size={18} color={theme.colors.textMuted} />
                </TouchableOpacity>
            )}
        </Animated.View>
    );
}

// Toast provider
export function ToastProvider({ children }: { children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    const [toasts, setToasts] = useState<ToastConfig[]>([]);
    const toastIdRef = useRef(0);

    const show = useCallback((config: Omit<ToastConfig, 'id'>): string => {
        const id = `toast_${++toastIdRef.current}`;
        setToasts(prev => [...prev, { ...config, id }]);
        return id;
    }, []);

    const dismiss = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const dismissAll = useCallback(() => {
        setToasts([]);
    }, []);

    const update = useCallback((id: string, config: Partial<Omit<ToastConfig, 'id'>>) => {
        setToasts(prev => prev.map(t => 
            t.id === id ? { ...t, ...config } : t
        ));
    }, []);

    const success = useCallback((title: string, message?: string, duration?: number) => {
        return show({ type: 'success', title, message, duration });
    }, [show]);

    const error = useCallback((title: string, message?: string, duration?: number) => {
        return show({ type: 'error', title, message, duration: duration || 5000 });
    }, [show]);

    const info = useCallback((title: string, message?: string, duration?: number) => {
        return show({ type: 'info', title, message, duration });
    }, [show]);

    const warning = useCallback((title: string, message?: string, duration?: number) => {
        return show({ type: 'warning', title, message, duration });
    }, [show]);

    const loading = useCallback((title: string, message?: string) => {
        return show({ type: 'loading', title, message, duration: 0 });
    }, [show]);

    const contextValue: ToastContextType = {
        show,
        success,
        error,
        info,
        warning,
        loading,
        dismiss,
        dismissAll,
        update,
    };

    return (
        <ToastContext.Provider value={contextValue}>
            {children}
            {/* Toast container */}
            <View 
                style={[
                    styles.container, 
                    { top: insets.top + spacing.md }
                ]}
                pointerEvents="box-none"
            >
                {toasts.map((toast, index) => (
                    <ToastItem
                        key={toast.id}
                        toast={toast}
                        index={index}
                        onDismiss={() => dismiss(toast.id)}
                    />
                ))}
            </View>
        </ToastContext.Provider>
    );
}

// Hook to use toast
export function useToast(): ToastContextType {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: spacing.md,
        right: spacing.md,
        zIndex: 9999,
    },
    toastContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        borderLeftWidth: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
        gap: spacing.sm,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
    },
    title: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    message: {
        fontSize: fontSize.sm,
        marginTop: 2,
    },
    actionButton: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
    },
    actionText: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
    dismissButton: {
        padding: spacing.xs,
    },
});

export default ToastProvider;
