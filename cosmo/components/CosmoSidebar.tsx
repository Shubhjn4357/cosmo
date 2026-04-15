/**
 * Cosmo AI — Redesigned Glassmorphic Sidebar
 * Cosmic dark/light, animated spring entry, swipe-to-close, role-based nav sections
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

const NAV_SECTIONS = [
    {
        label: 'CORE',
        items: [
            { id: 'index',    label: 'Chat',     icon: 'chatbubbles-outline' as const,  activeIcon: 'chatbubbles' as const,  route: '/(tabs)',          accent: '#8b5cf6' },
            { id: 'image',    label: 'Create',   icon: 'sparkles-outline' as const,     activeIcon: 'sparkles' as const,     route: '/(tabs)/image',    accent: '#06b6d4' },
            { id: 'roleplay', label: 'Roleplay', icon: 'people-outline' as const,       activeIcon: 'people' as const,       route: '/(tabs)/roleplay', accent: '#ec4899' },
        ],
    },
    {
        label: 'COSMO CORP',
        items: [
            { id: 'business', label: 'Business Agent', icon: 'briefcase-outline' as const, activeIcon: 'briefcase' as const, route: '/(tabs)/business', accent: '#f59e0b' },
        ],
    },
    {
        label: 'SYSTEM',
        items: [
            { id: 'models',   label: 'Models',   icon: 'cube-outline' as const,     activeIcon: 'cube' as const,     route: '/(tabs)/models',   accent: '#10b981' },
            { id: 'settings', label: 'Settings', icon: 'settings-outline' as const, activeIcon: 'settings' as const, route: '/(tabs)/settings', accent: '#a78bfa' },
        ],
    },
];

interface SidebarProps {
    visible: boolean;
    onClose: () => void;
    histories: ChatHistory[];
    onSelectHistory: (history: ChatHistory) => void;
    onNewChat: () => void;
    onDeleteHistory?: (id: string) => void;
}

export function CosmoSidebar({ visible, onClose, onNewChat }: SidebarProps) {
    const { theme, isDark, toggleTheme } = useTheme();
    const { signOut, isAuthenticated } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();

    const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
    const overlayOpacity = useRef(new Animated.Value(0)).current;
    const logoScale = useRef(new Animated.Value(0.85)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(slideAnim, {
                    toValue: 0,
                    useNativeDriver: true,
                    tension: 70,
                    friction: 12,
                }),
                Animated.timing(overlayOpacity, {
                    toValue: 1,
                    duration: 220,
                    useNativeDriver: true,
                }),
                Animated.spring(logoScale, {
                    toValue: 1,
                    tension: 80,
                    friction: 10,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: -SIDEBAR_WIDTH,
                    duration: 240,
                    useNativeDriver: true,
                }),
                Animated.timing(overlayOpacity, {
                    toValue: 0,
                    duration: 180,
                    useNativeDriver: true,
                }),
                Animated.timing(logoScale, {
                    toValue: 0.85,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible]);

    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, gs) => gs.dx < -10,
            onPanResponderMove: (_, gs) => {
                if (gs.dx < 0) slideAnim.setValue(gs.dx);
            },
            onPanResponderRelease: (_, gs) => {
                if (gs.dx < -SIDEBAR_WIDTH / 3) {
                    onClose();
                } else {
                    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }).start();
                }
            },
        })
    ).current;

    const handleNavigation = (route: string) => {
        onClose();
        router.push(route as any);
    };

    const isActiveRoute = (id: string) => {
        if (id === 'index') return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/index';
        return pathname.includes(id);
    };

    if (!visible) return null;

    const bg = isDark ? 'rgba(5,5,18,0.97)' : 'rgba(248,247,255,0.97)';
    const borderCol = isDark ? 'rgba(139,92,246,0.12)' : 'rgba(124,58,237,0.10)';

    return (
        <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
            <View style={styles.modalContainer}>
                {/* Backdrop */}
                <TouchableWithoutFeedback onPress={onClose}>
                    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} />
                </TouchableWithoutFeedback>

                {/* Sidebar */}
                <Animated.View
                    {...panResponder.panHandlers}
                    style={[
                        styles.sidebar,
                        {
                            width: SIDEBAR_WIDTH,
                            transform: [{ translateX: slideAnim }],
                            backgroundColor: bg,
                            borderRightColor: borderCol,
                            paddingTop: insets.top + 8,
                            paddingBottom: insets.bottom + 8,
                        },
                    ]}
                >
                    {/* ── Logo Header ────────────────────────────────── */}
                    <Animated.View style={[styles.header, { transform: [{ scale: logoScale }] }]}>
                        <View style={styles.logoRow}>
                            <View style={styles.logoOrb}>
                                <Ionicons name="planet" size={24} color={theme.colors.primary} />
                            </View>
                            <View>
                                <Text style={[styles.logoTitle, { color: theme.colors.text }]}>Cosmo AI</Text>
                                <Text style={[styles.logoSub, { color: theme.colors.textMuted }]}>Autonomous IQ</Text>
                            </View>
                        </View>
                        <TouchableOpacity
                            onPress={onClose}
                            style={[styles.closeBtn, { backgroundColor: theme.colors.surfaceLight }]}
                        >
                            <Ionicons name="close" size={18} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    </Animated.View>

                    {/* ── New Chat CTA ────────────────────────────────── */}
                    <TouchableOpacity
                        style={[styles.newChatBtn, { borderColor: theme.colors.primary }]}
                        onPress={() => { onNewChat(); onClose(); }}
                        activeOpacity={0.8}
                    >
                        <View style={[styles.newChatIcon, { backgroundColor: theme.colors.primary }]}>
                            <Ionicons name="add" size={16} color="#fff" />
                        </View>
                        <Text style={[styles.newChatText, { color: theme.colors.primary }]}>New Conversation</Text>
                    </TouchableOpacity>

                    {/* ── Navigation ─────────────────────────────────── */}
                    {NAV_SECTIONS.map((section) => (
                        <View key={section.label} style={styles.navSection}>
                            <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>
                                {section.label}
                            </Text>
                            {section.items.map((item) => {
                                const isActive = isActiveRoute(item.id);
                                return (
                                    <TouchableOpacity
                                        key={item.id}
                                        style={[
                                            styles.navItem,
                                            isActive && {
                                                backgroundColor: item.accent + '18',
                                                borderColor: item.accent + '30',
                                            },
                                            !isActive && { borderColor: 'transparent' },
                                        ]}
                                        onPress={() => handleNavigation(item.route)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={[
                                            styles.navIconWrap,
                                            { backgroundColor: isActive ? item.accent + '22' : theme.colors.surfaceLight },
                                        ]}>
                                            <Ionicons
                                                name={isActive ? item.activeIcon : item.icon}
                                                size={17}
                                                color={isActive ? item.accent : theme.colors.textMuted}
                                            />
                                        </View>
                                        <Text style={[
                                            styles.navItemText,
                                            { color: isActive ? item.accent : theme.colors.text },
                                            isActive && { fontWeight: '700' },
                                        ]}>
                                            {item.label}
                                        </Text>
                                        {isActive && (
                                            <View style={[styles.activeBar, { backgroundColor: item.accent }]} />
                                        )}
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    ))}

                    {/* ── User Footer ─────────────────────────────────── */}
                    <View style={[styles.footer, { borderTopColor: theme.colors.surfaceBorder }]}>
                        {/* Theme toggle */}
                        <TouchableOpacity
                            style={[styles.footerBtn, { backgroundColor: theme.colors.surfaceLight }]}
                            onPress={toggleTheme}
                        >
                            <Ionicons
                                name={isDark ? 'sunny-outline' : 'moon-outline'}
                                size={17}
                                color={theme.colors.text}
                            />
                            <Text style={[styles.footerBtnText, { color: theme.colors.text }]}>
                                {isDark ? 'Light Mode' : 'Dark Mode'}
                            </Text>
                        </TouchableOpacity>

                        {/* Auth action */}
                        {isAuthenticated ? (
                            <TouchableOpacity
                                style={[styles.footerBtn, { backgroundColor: theme.colors.error + '18' }]}
                                onPress={async () => { await signOut(); onClose(); router.replace('/(tabs)'); }}
                            >
                                <Ionicons name="log-out-outline" size={17} color={theme.colors.error} />
                                <Text style={[styles.footerBtnText, { color: theme.colors.error }]}>Logout</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[styles.footerBtn, { backgroundColor: theme.colors.primary }]}
                                onPress={() => { onClose(); router.push('/auth/login'); }}
                            >
                                <Ionicons name="log-in-outline" size={17} color="#fff" />
                                <Text style={[styles.footerBtnText, { color: '#fff' }]}>Sign In</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalContainer: { flex: 1, flexDirection: 'row' },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
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
        paddingBottom: spacing.md,
    },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    logoOrb: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(139,92,246,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoTitle: { fontSize: fontSize.md, fontWeight: '700' },
    logoSub: { fontSize: fontSize.xs, marginTop: 1 },
    closeBtn: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    newChatBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginHorizontal: spacing.md,
        marginBottom: spacing.md,
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
    },
    newChatIcon: {
        width: 24,
        height: 24,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    newChatText: { fontSize: fontSize.sm, fontWeight: '600' },
    navSection: { paddingHorizontal: spacing.md, marginBottom: spacing.xs },
    sectionLabel: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.2,
        marginBottom: spacing.xs,
        marginTop: spacing.sm,
    },
    navItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: 10,
        paddingHorizontal: spacing.sm,
        borderRadius: borderRadius.md,
        marginBottom: 2,
        borderWidth: 1,
        position: 'relative',
    },
    navIconWrap: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    navItemText: { fontSize: fontSize.sm, fontWeight: '500', flex: 1 },
    activeBar: {
        width: 3,
        height: 18,
        borderRadius: 2,
        position: 'absolute',
        right: 8,
    },
    footer: {
        marginTop: 'auto',
        borderTopWidth: 1,
        paddingTop: spacing.md,
        paddingHorizontal: spacing.md,
        flexDirection: 'column',
        gap: spacing.xs,
    },
    footerBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        borderRadius: borderRadius.md,
    },
    footerBtnText: { fontSize: fontSize.sm, fontWeight: '600' },
});

export default CosmoSidebar;
