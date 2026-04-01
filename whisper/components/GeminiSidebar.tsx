/**
 * Whisper App - Redesigned Sidebar Navigation
 * Full navigation sidebar with tabs and quick account controls.
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
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { ChatHistory } from '@/types';
import { useAuth } from '@/hooks/useAuth';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SIDEBAR_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 320);

// Navigation items (moved from bottom tabs)
const NAV_ITEMS = [
    { id: 'index', label: 'Chat', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles', route: '/(tabs)' },
    { id: 'image', label: 'Create', icon: 'sparkles-outline', activeIcon: 'sparkles', route: '/(tabs)/image' },
    { id: 'roleplay', label: 'Roleplay', icon: 'people-outline', activeIcon: 'people', route: '/(tabs)/roleplay' },
    { id: 'upscale', label: 'Upscale', icon: 'scan-outline', activeIcon: 'scan', route: '/(tabs)/upscale' },
    { id: 'faceswap', label: 'Face Swap', icon: 'camera-reverse-outline', activeIcon: 'camera-reverse', route: '/(tabs)/faceswap' },
    { id: 'models', label: 'Models', icon: 'cube-outline', activeIcon: 'cube', route: '/(tabs)/models' },
    { id: 'settings', label: 'Settings', icon: 'settings-outline', activeIcon: 'settings', route: '/(tabs)/settings' },
];

interface SidebarProps {
    visible: boolean;
    onClose: () => void;
    histories: ChatHistory[];
    onSelectHistory: (history: ChatHistory) => void;
    onNewChat: () => void;
    onDeleteHistory?: (id: string) => void;
}

export function GeminiSidebar({
    visible,
    onClose,
    onNewChat,
}: SidebarProps) {
    const { theme, isDark, toggleTheme } = useTheme();
    const { signOut, isAuthenticated, user } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
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
                    toValue: -SIDEBAR_WIDTH,
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

    // Swipe to close
    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, gestureState) => {
                return gestureState.dx < -10;
            },
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dx < 0) {
                    slideAnim.setValue(gestureState.dx);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dx < -SIDEBAR_WIDTH / 3) {
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

    const handleNavigation = (route: string) => {
        onClose();
        router.push(route as any);
    };

    const isActiveRoute = (item: typeof NAV_ITEMS[0]) => {
        if (item.id === 'index') {
            return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/index';
        }
        return pathname.includes(item.id);
    };

    if (!visible) return null;

    return (
        <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
            <View style={styles.modalContainer}>
                {/* Overlay */}
                <TouchableWithoutFeedback onPress={onClose}>
                    <Animated.View 
                        style={[
                            styles.overlay, 
                            { opacity: overlayOpacity }
                        ]} 
                    />
                </TouchableWithoutFeedback>

                {/* Sidebar */}
                <Animated.View
                    {...panResponder.panHandlers}
                    style={[
                        styles.sidebar,
                        {
                            width: SIDEBAR_WIDTH,
                            transform: [{ translateX: slideAnim }],
                            backgroundColor: isDark 
                                ? 'rgba(15, 15, 25, 0.98)'
                                : 'rgba(250, 250, 252, 0.98)',
                            borderRightColor: theme.colors.surfaceBorder,
                            paddingTop: insets.top,
                            paddingBottom: insets.bottom,
                        },
                    ]}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.logoContainer}>
                            <View style={[styles.logoIcon, { backgroundColor: theme.colors.primary + '20' }]}>
                                <Ionicons name="sparkles" size={20} color={theme.colors.primary} />
                            </View>
                            <Text style={[styles.title, { color: theme.colors.text }]}>Whisper AI</Text>
                        </View>
                        <TouchableOpacity
                            onPress={onClose}
                            style={[styles.closeButton, { backgroundColor: theme.colors.surfaceLight }]}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <Ionicons name="close" size={20} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {/* New Chat Button */}
                    <TouchableOpacity
                        style={[styles.newChatButton, { backgroundColor: theme.colors.primary }]}
                        onPress={() => {
                            onNewChat();
                            onClose();
                        }}
                    >
                        <Ionicons name="add" size={22} color="#fff" />
                        <Text style={styles.newChatText}>New Chat</Text>
                    </TouchableOpacity>

                    {/* Navigation Items */}
                    <View style={styles.navSection}>
                        <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
                            NAVIGATION
                        </Text>
                        {NAV_ITEMS.map((item) => {
                            const isActive = isActiveRoute(item);
                            return (
                                <TouchableOpacity
                                    key={item.id}
                                    style={[
                                        styles.navItem,
                                        isActive && { backgroundColor: theme.colors.primary + '15' },
                                    ]}
                                    onPress={() => handleNavigation(item.route)}
                                >
                                    <Ionicons
                                        name={isActive ? item.activeIcon as any : item.icon as any}
                                        size={20}
                                        color={isActive ? theme.colors.primary : theme.colors.textMuted}
                                    />
                                    <Text
                                        style={[
                                            styles.navItemText,
                                            { color: isActive ? theme.colors.primary : theme.colors.text }
                                        ]}
                                    >
                                        {item.label}
                                    </Text>
                                    {isActive && (
                                        <View style={[styles.activeIndicator, { backgroundColor: theme.colors.primary }]} />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {/* Settings Row - Auth aware */}
                    <View style={[styles.settingsRow, { borderTopColor: theme.colors.surfaceBorder }]}>
                        {isAuthenticated ? (
                            <>
                                <TouchableOpacity
                                    style={[styles.settingButton, { backgroundColor: theme.colors.surface }]}
                                    onPress={async () => {
                                        await signOut();
                                        onClose();
                                        router.replace('/(tabs)');
                                    }}
                                >
                                    <Ionicons name="log-out-outline" size={20} color={theme.colors.error} />
                                    <Text style={[styles.settingText, { color: theme.colors.error }]}>Logout</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.settingButton, { backgroundColor: theme.colors.surface }]}
                                    onPress={toggleTheme}
                                >
                                    <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={theme.colors.text} />
                                    <Text style={[styles.settingText, { color: theme.colors.text }]}>
                                        {isDark ? 'Light' : 'Dark'}
                                    </Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <TouchableOpacity
                                    style={[styles.settingButton, { backgroundColor: theme.colors.primary }]}
                                    onPress={() => {
                                        onClose();
                                        router.push('/auth/login');
                                    }}
                                >
                                    <Ionicons name="log-in-outline" size={20} color="#fff" />
                                    <Text style={[styles.settingText, { color: '#fff' }]}>Sign In</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.settingButton, { backgroundColor: theme.colors.surface }]}
                                    onPress={toggleTheme}
                                >
                                    <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={theme.colors.text} />
                                    <Text style={[styles.settingText, { color: theme.colors.text }]}>
                                        {isDark ? 'Light' : 'Dark'}
                                    </Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>

                    {/* Divider */}
                    <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalContainer: {
        flex: 1,
        flexDirection: 'row',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    sidebar: {
        height: '100%',
        borderRightWidth: 1,
        flexDirection: 'column',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
    },
    logoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    logoIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: fontSize.xl,
        fontWeight: '700',
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    newChatButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        marginHorizontal: spacing.md,
        marginBottom: spacing.md,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
    },
    newChatText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    navSection: {
        paddingHorizontal: spacing.md,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1,
        marginBottom: spacing.sm,
        marginTop: spacing.sm,
    },
    navItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.xs,
        position: 'relative',
    },
    navItemText: {
        fontSize: fontSize.md,
        fontWeight: '500',
        flex: 1,
    },
    activeIndicator: {
        width: 4,
        height: 20,
        borderRadius: 2,
        position: 'absolute',
        right: 0,
    },
    divider: {
        height: 1,
        marginHorizontal: spacing.md,
        marginVertical: spacing.md,
    },
    settingsRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        borderTopWidth: 1,
    },
    settingButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
    },
    settingText: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
});

export default GeminiSidebar;
