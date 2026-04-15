/**
 * Cosmo App - Bottom Sheet Component
 * Slides up from bottom with attachment options
 */

import React, { useRef, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Animated,
    Dimensions,
    Modal,
    TouchableWithoutFeedback,
    PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { BlurView } from 'expo-blur';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = 320;

interface BottomSheetOption {
    icon: string;
    label: string;
    color?: string;
    onPress: () => void;
}

interface BottomSheetProps {
    visible: boolean;
    onClose: () => void;
    options: BottomSheetOption[];
    title?: string;
}

export function BottomSheet({ visible, onClose, options, title }: BottomSheetProps) {
    const { theme, isDark } = useTheme();
    const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;
    const overlayOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(slideAnim, {
                    toValue: 0,
                    useNativeDriver: true,
                    tension: 65,
                    friction: 11,
                }),
                Animated.timing(overlayOpacity, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: SHEET_HEIGHT,
                    duration: 250,
                    useNativeDriver: true,
                }),
                Animated.timing(overlayOpacity, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible]);

    // Swipe to dismiss
    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dy > 0) {
                    slideAnim.setValue(gestureState.dy);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > SHEET_HEIGHT / 3 || gestureState.vy > 0.5) {
                    onClose();
                } else {
                    Animated.spring(slideAnim, {
                        toValue: 0,
                        useNativeDriver: true,
                    }).start();
                }
            },
        })
    ).current;

    if (!visible) return null;

    return (
        <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
            <View style={styles.container}>
                {/* Overlay */}
                <TouchableWithoutFeedback onPress={onClose}>
                    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} />
                </TouchableWithoutFeedback>

                {/* Sheet */}
                <Animated.View
                    {...panResponder.panHandlers}
                    style={[
                        styles.sheet,
                        {
                            transform: [{ translateY: slideAnim }],
                            backgroundColor: isDark ? 'rgba(30, 30, 40, 0.98)' : 'rgba(255, 255, 255, 0.98)',
                        },
                    ]}
                >
                    {/* Handle */}
                    <View style={styles.handleContainer}>
                        <View style={[styles.handle, { backgroundColor: theme.colors.textMuted }]} />
                    </View>

                    {/* Title */}
                    {title && (
                        <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
                    )}

                    {/* Options Grid */}
                    <View style={styles.optionsGrid}>
                        {options.map((option, index) => (
                            <TouchableOpacity
                                key={index}
                                style={[styles.option]}
                                onPress={() => {
                                    option.onPress();
                                    onClose();
                                }}
                            >
                                <View style={[styles.iconContainer,{backgroundColor: (option.color || theme.colors.primary) + '20',borderRadius: borderRadius.lg}]}>
                                    <Ionicons
                                        name={option.icon as any}
                                        size={24}
                                        color={option.color || theme.colors.primary}
                                    />
                                </View>
                                <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
                                    {option.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Cancel Button */}
                    <TouchableOpacity
                        style={[styles.cancelButton, { borderColor: theme.colors.surfaceBorder }]}
                        onPress={onClose}
                    >
                        <Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>Cancel</Text>
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    sheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: 40,
        minHeight: SHEET_HEIGHT,
    },
    handleContainer: {
        alignItems: 'center',
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    title: {
        fontSize: fontSize.lg,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: spacing.md,
    },
    optionsGrid: {
        flexDirection: 'row',
        paddingHorizontal: spacing.lg,
        gap: spacing.md,
    },
    option: {
        width: 'auto',
        flexGrow: 1,
        alignItems: 'center',
        paddingVertical: spacing.lg,
        borderRadius: borderRadius.lg,
        gap: spacing.sm,
    },
    iconContainer: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    optionLabel: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    cancelButton: {
        marginHorizontal: spacing.lg,
        marginTop: spacing.lg,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        alignItems: 'center',
    },
    cancelText: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
});

export default BottomSheet;
