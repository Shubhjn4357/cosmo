import React, { useState } from 'react';
import {
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { GeminiSidebar } from '@/components/GeminiSidebar';
import { useDialog } from '@/components/Dialog';
import { useToast } from '@/components/Toast';
import { borderRadius, fontSize, spacing, useTheme } from '@/constants/theme';
import { useAppPreferences, useAuth, useChat } from '@/hooks';

export default function SettingsScreen() {
    const { theme, isDark, toggleTheme } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const dialog = useDialog();
    const toast = useToast();
    const { isAuthenticated, signOut, profile } = useAuth();
    const { chatHistories, loadHistory, startNewChat, deleteHistory } = useChat();
    const { enterToSend, nsfwEnabled, setEnterToSend, setNsfwEnabled } = useAppPreferences();
    const [showSidebar, setShowSidebar] = useState(false);

    const bottomPadding = Math.max(insets.bottom, 16) + spacing.lg;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <GeminiSidebar
                visible={showSidebar}
                onClose={() => setShowSidebar(false)}
                histories={chatHistories}
                onSelectHistory={loadHistory}
                onNewChat={startNewChat}
                onDeleteHistory={(historyId) => {
                    void deleteHistory(historyId);
                }}
            />

            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <View style={styles.headerBar}>
                    <TouchableOpacity
                        onPress={() => setShowSidebar(true)}
                        style={styles.menuButton}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons name="menu" size={26} color={theme.colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Settings</Text>
                </View>

                <ScrollView
                    style={styles.scrollView}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: bottomPadding }}
                >
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            APPEARANCE
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <TouchableOpacity style={styles.settingRow} onPress={toggleTheme}>
                                <View style={[styles.iconContainer, { backgroundColor: (isDark ? theme.colors.primary : theme.colors.warning) + '20' }]}>
                                    <Ionicons
                                        name={isDark ? 'moon' : 'sunny'}
                                        size={20}
                                        color={isDark ? theme.colors.primary : theme.colors.warning}
                                    />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Dark Mode</Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        {isDark ? 'Enabled' : 'Disabled'}
                                    </Text>
                                </View>
                                <Switch
                                    value={isDark}
                                    onValueChange={toggleTheme}
                                    trackColor={{ false: theme.colors.surfaceLight, true: theme.colors.primary + '60' }}
                                    thumbColor={isDark ? theme.colors.primary : theme.colors.surface}
                                />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            CHAT
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <View style={styles.settingRow}>
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.error + '20' }]}>
                                    <Ionicons name="warning-outline" size={20} color={theme.colors.error} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>18+ Mode</Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        {nsfwEnabled ? 'Adult chat and adult characters are enabled' : 'Adult content is hidden'}
                                    </Text>
                                </View>
                                <Switch
                                    value={nsfwEnabled}
                                    onValueChange={(value) => {
                                        void setNsfwEnabled(value);
                                        toast.info(value ? '18+ Mode' : 'Safe Mode', value ? 'Adult mode enabled' : 'Adult mode disabled');
                                    }}
                                    trackColor={{ false: theme.colors.surfaceLight, true: theme.colors.error + '60' }}
                                    thumbColor={nsfwEnabled ? theme.colors.error : theme.colors.surface}
                                />
                            </View>

                            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                            <View style={styles.settingRow}>
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.accent + '20' }]}>
                                    <Ionicons name="return-down-back" size={20} color={theme.colors.accent} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Enter to Send</Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Send messages immediately when you press Enter
                                    </Text>
                                </View>
                                <Switch
                                    value={enterToSend}
                                    onValueChange={(value) => {
                                        void setEnterToSend(value);
                                    }}
                                    trackColor={{ false: theme.colors.surfaceLight, true: theme.colors.primary + '60' }}
                                    thumbColor={enterToSend ? theme.colors.primary : theme.colors.surface}
                                />
                            </View>
                        </View>
                    </View>

                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            ACCOUNT
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <TouchableOpacity
                                style={styles.settingRow}
                                onPress={() => router.push('/personality' as any)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.accent + '20' }]}>
                                    <Ionicons name="sparkles-outline" size={20} color={theme.colors.accent} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>AI Personality</Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Applies across cloud, server, self, and local chat modes
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>

                            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                            <TouchableOpacity
                                style={styles.settingRow}
                                onPress={() => router.push('/profile/edit')}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                                    <Ionicons name="person-outline" size={20} color={theme.colors.primary} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Profile</Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Edit your public profile
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>

                            {isAuthenticated && (
                                <>
                                    <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                                    <TouchableOpacity
                                        style={styles.settingRow}
                                        onPress={() => {
                                            dialog.confirm({
                                                title: 'Logout',
                                                message: 'Sign out of your account?',
                                                icon: 'log-out-outline',
                                                iconColor: theme.colors.error,
                                                confirmText: 'Logout',
                                                confirmStyle: 'destructive',
                                                onConfirm: async () => {
                                                    await signOut();
                                                    router.replace('/auth/login');
                                                },
                                            });
                                        }}
                                    >
                                        <View style={[styles.iconContainer, { backgroundColor: theme.colors.error + '20' }]}>
                                            <Ionicons name="log-out-outline" size={20} color={theme.colors.error} />
                                        </View>
                                        <View style={styles.settingInfo}>
                                            <Text style={[styles.settingLabel, { color: theme.colors.error }]}>Logout</Text>
                                            <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                                Sign out of {profile?.display_name || 'your account'}
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={theme.colors.error} />
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    </View>

                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            SUPPORT
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <TouchableOpacity
                                style={styles.settingRow}
                                onPress={() => router.push('/about' as any)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                                    <Ionicons name="information-circle-outline" size={20} color={theme.colors.primary} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>About Whisper AI</Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Project details and version info
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>

                            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                            <TouchableOpacity
                                style={styles.settingRow}
                                onPress={() => router.push('/terms' as any)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.accent + '20' }]}>
                                    <Ionicons name="document-text-outline" size={20} color={theme.colors.accent} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Terms of Service</Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Read the current terms
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>

                            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                            <TouchableOpacity
                                style={styles.settingRow}
                                onPress={() => router.push('/privacy' as any)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.success + '20' }]}>
                                    <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.success} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Privacy Policy</Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        How your data is handled
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                    </View>
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
    section: {
        paddingHorizontal: spacing.lg,
        marginBottom: spacing.lg,
    },
    sectionTitle: {
        fontSize: fontSize.xs,
        fontWeight: '600',
        letterSpacing: 1,
        marginBottom: spacing.sm,
    },
    card: {
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        overflow: 'hidden',
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        gap: spacing.md,
    },
    iconContainer: {
        width: 36,
        height: 36,
        borderRadius: borderRadius.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    settingInfo: {
        flex: 1,
    },
    settingLabel: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    settingHint: {
        fontSize: fontSize.xs,
        marginTop: 2,
    },
    divider: {
        height: 1,
        marginHorizontal: spacing.md,
    },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.md,
    },
    menuButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
});
