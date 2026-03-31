import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Switch,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { whisperAPI, HealthStatus } from '@/services/api';
import { useAuth, useChat } from '@/hooks';
import { GeminiSidebar } from '@/components/GeminiSidebar';
import { useToast } from '@/components/Toast';
import { useDialog } from '@/components/Dialog';
import { preferencesAPI } from '@/services/profileAPI';

export default function SettingsScreen() {
    const { theme, isDark, toggleTheme } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const toast = useToast();
    const dialog = useDialog();
    const { isAuthenticated, signOut, profile, refreshProfile } = useAuth();
    const { chatHistories, loadHistory, startNewChat } = useChat();
    const [showSidebar, setShowSidebar] = useState(false);
    const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-whisper-ai.hf.space';
    const [serverUrl, setServerUrl] = useState(API_BASE_URL);
    const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLearning, setIsLearning] = useState(false);
    const [enterToSend, setEnterToSend] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [smartModeEnabled, setSmartModeEnabled] = useState(false);
    const [hfApiKey, setHfApiKey] = useState('');
    const [hfModel, setHfModel] = useState('FLUX.1-schnell');
    const [nsfw18Plus, setNsfw18Plus] = useState(false);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await checkHealth();
        if (refreshProfile) await refreshProfile();
        setRefreshing(false);
    }, [refreshProfile]);

    const checkHealth = async () => {
        setIsChecking(true);
        setError(null);

        try {
            whisperAPI.setBaseUrl(serverUrl);
            const status = await whisperAPI.getHealth();
            setHealthStatus(status);
        } catch (err) {
            setError('Cannot connect to server');
            setHealthStatus(null);
        } finally {
            setIsChecking(false);
        }
    };

    const triggerLearning = async () => {
        setIsLearning(true);
        try {
            const result = await whisperAPI.addKnowledge(
                "Whisper AI is a self-learning artificial intelligence system that continuously improves.",
                "manual_trigger"
            );
            toast.success('Success', `Learning triggered! Indexed ${result.chunks_indexed} chunks.`);
        } catch (err) {
            toast.error('Error', 'Failed to trigger learning. Make sure server is running.');
        } finally {
            setIsLearning(false);
        }
    };

    const clearChat = async () => {
        dialog.confirm({
            title: 'Clear Chat History',
            message: 'This will delete all chat history. Are you sure?',
            icon: 'trash-outline',
            iconColor: '#ef4444',
            confirmText: 'Clear',
            confirmStyle: 'destructive',
            onConfirm: async () => {
                await AsyncStorage.removeItem('chatHistories');
                toast.success('Done', 'Chat history cleared. Restart the app to see changes.');
            },
        });
    };

    const toggleEnterToSend = async (value: boolean) => {
        setEnterToSend(value);
        await AsyncStorage.setItem('enterToSend', value.toString());
    };

    const toggleSmartMode = async (value: boolean) => {
        setSmartModeEnabled(value);
        await AsyncStorage.setItem('smartModeEnabled', value.toString());

        // Sync to server (save as preference)
        if (profile?.id) {
            try {
                await preferencesAPI.updateHfModel(profile.id, value ? 'smart' : hfModel);
                toast.success('Smart Mode', value ? 'Enabled multi-API smart mode' : 'Disabled smart mode');
            } catch (err) {
                toast.error('Sync Failed', 'Setting saved locally only');
            }
        }
    };

    const toggle18Plus = async (value: boolean) => {
        setNsfw18Plus(value);
        await AsyncStorage.setItem('nsfw18Plus', value.toString());

        // Sync to server
        if (profile?.id) {
            try {
                await preferencesAPI.updateNsfwPreference(profile.id, value);
                toast.success('Saved', '18+ mode synced to server');
            } catch (err) {
                toast.error('Sync Failed', 'Preference saved locally only');
            }
        }
        await AsyncStorage.setItem('nsfw18Plus', value.toString());
        if (value) {
            toast.info('18+ Mode', '18+ content is now visible');
        } else {
            toast.info('Safe Mode', 'NSFW content is now hidden');
        }
    };

    useEffect(() => {
        const loadSettings = async () => {
            const enterSend = await AsyncStorage.getItem('enterToSend');
            if (enterSend !== null) setEnterToSend(enterSend === 'true');

            const smartMode = await AsyncStorage.getItem('smartModeEnabled');
            if (smartMode !== null) setSmartModeEnabled(smartMode === 'true');

            const hfKey = await AsyncStorage.getItem('hfApiKey');
            if (hfKey) setHfApiKey(hfKey);

            const hfModelPref = await AsyncStorage.getItem('hfModel');
            if (hfModelPref) setHfModel(hfModelPref);

            const nsfwMode = await AsyncStorage.getItem('nsfw18Plus');
            if (nsfwMode !== null) setNsfw18Plus(nsfwMode === 'true');
        };
        loadSettings();
        checkHealth();
    }, []);

    const bottomPadding = Math.max(insets.bottom, 16) + spacing.lg;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Sidebar */}
            <GeminiSidebar
                visible={showSidebar}
                onClose={() => setShowSidebar(false)}
                histories={chatHistories}
                onSelectHistory={loadHistory}
                onNewChat={startNewChat}
            />

            <SafeAreaView style={styles.safeArea} edges={['top']}>
                {/* Header with hamburger menu */}
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
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
                    }
                >

                    {/* Appearance */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            APPEARANCE
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <TouchableOpacity 
                                style={styles.settingRow}
                                onPress={toggleTheme}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: isDark ? theme.colors.primary + '20' : theme.colors.warning + '20' }]}>
                                    <Ionicons 
                                        name={isDark ? 'moon' : 'sunny'} 
                                        size={20} 
                                        color={isDark ? theme.colors.primary : theme.colors.warning} 
                                    />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        Dark Mode
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        {isDark ? 'On' : 'Off'}
                                    </Text>
                                </View>
                                <Switch
                                    value={isDark}
                                    onValueChange={toggleTheme}
                                    trackColor={{ false: theme.colors.surfaceLight, true: theme.colors.primary + '60' }}
                                    thumbColor={isDark ? theme.colors.primary : theme.colors.surface}
                                />
                            </TouchableOpacity>

                            {/* 18+ Mode Toggle */}
                            <View style={styles.settingRow}>
                                <View style={[styles.iconContainer, { backgroundColor: '#FF1744' + '20' }]}>
                                    <Ionicons name="warning" size={20} color="#FF1744" />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        18+ Mode
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        {nsfw18Plus ? 'NSFW content visible' : 'NSFW content hidden'}
                                    </Text>
                                </View>
                                <Switch
                                    value={nsfw18Plus}
                                    onValueChange={toggle18Plus}
                                    trackColor={{ false: theme.colors.surfaceLight, true: '#FF1744' + '60' }}
                                    thumbColor={nsfw18Plus ? '#FF1744' : theme.colors.surface}
                                />
                            </View>
                        </View>
                    </View>

                    {/* AI Configuration */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            AI SETTINGS
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                        {/* Smart Mode */}
                        <View style={styles.settingRow}>
                            <View style={[styles.iconContainer, { backgroundColor: theme.colors.accent + '20' }]}>
                                <Ionicons name="flash" size={20} color={theme.colors.accent} />
                            </View>
                            <View style={styles.settingInfo}>
                                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                    Smart Mode
                                </Text>
                                <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                    Auto-select best AI model
                                </Text>
                            </View>
                            <Switch
                                value={smartModeEnabled}
                                onValueChange={setSmartModeEnabled}
                                trackColor={{ false: theme.colors.surfaceLight, true: theme.colors.primary }}
                                thumbColor="#fff"
                            />
                        </View>

                        <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                        {/* HuggingFace API */}
                        <TouchableOpacity
                            style={styles.settingRow}
                            onPress={() => {
                                dialog.options({
                                    title: 'HuggingFace API',
                                    message: `Current Model: ${hfModel}\nStatus: ${hfApiKey ? 'Configured ✓' : 'Not configured'}`,
                                    icon: 'cube',
                                    iconColor: '#FFD21E',
                                    options: [
                                        {
                                            text: 'FLUX.1-schnell (Fast)',
                                            onPress: async () => {
                                                setHfModel('FLUX.1-schnell');
                                                await AsyncStorage.setItem('hfModel', 'FLUX.1-schnell');
                                                // Sync to server
                                                if (profile?.id) {
                                                    try {
                                                        await preferencesAPI.updateHfModel(profile.id, 'FLUX.1-schnell');
                                                        toast.success('Model Updated', 'Using FLUX.1-schnell (synced)');
                                                    } catch (err) {
                                                        toast.success('Model Updated', 'Using FLUX.1-schnell (local only)');
                                                    }
                                                } else {
                                                    toast.success('Model Updated', 'Using FLUX.1-schnell');
                                                }
                                            },
                                        },
                                        {
                                            text: 'FLUX.1-dev (Better Quality)',
                                            onPress: async () => {
                                                setHfModel('FLUX.1-dev');
                                                await AsyncStorage.setItem('hfModel', 'FLUX.1-dev');
                                                // Sync to server
                                                if (profile?.id) {
                                                    try {
                                                        await preferencesAPI.updateHfModel(profile.id, 'FLUX.1-dev');
                                                        toast.success('Model Updated', 'Using FLUX.1-dev (synced)');
                                                    } catch (err) {
                                                        toast.success('Model Updated', 'Using FLUX.1-dev (local only)');
                                                    }
                                                } else {
                                                    toast.success('Model Updated', 'Using FLUX.1-dev');
                                                }
                                            },
                                        },
                                        {
                                            text: 'Stable Diffusion XL',
                                            onPress: async () => {
                                                setHfModel('stabilityai/stable-diffusion-xl-base-1.0');
                                                await AsyncStorage.setItem('hfModel', 'stabilityai/stable-diffusion-xl-base-1.0');
                                                // Sync to server
                                                if (profile?.id) {
                                                    try {
                                                        await preferencesAPI.updateHfModel(profile.id, 'stabilityai/stable-diffusion-xl-base-1.0');
                                                        toast.success('Model Updated', 'Using SD-XL (synced)');
                                                    } catch (err) {
                                                        toast.success('Model Updated', 'Using SD-XL (local only)');
                                                    }
                                                } else {
                                                    toast.success('Model Updated', 'Using SD-XL');
                                                }
                                            },
                                        },
                                    ],
                                });
                            }}
                        >
                            <View style={[styles.iconContainer, { backgroundColor: '#FFD21E' + '20' }]}>
                                <Ionicons name="cube" size={20} color="#FFD21E" />
                            </View>
                            <View style={styles.settingInfo}>
                                <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                    HuggingFace API
                                </Text>
                                <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                    {hfApiKey ? 'Configured ✓' : 'Not configured'}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    </View>

                    {/* Chat Settings */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            CHAT
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <View style={styles.settingRow}>
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.accent + '20' }]}>
                                    <Ionicons name="return-down-back" size={20} color={theme.colors.accent} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        Enter to Send
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Press Enter to send messages
                                    </Text>
                                </View>
                                <Switch
                                    value={enterToSend}
                                    onValueChange={toggleEnterToSend}
                                    trackColor={{ false: theme.colors.surfaceLight, true: theme.colors.primary }}
                                    thumbColor="#fff"
                                />
                            </View>

                            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                            <TouchableOpacity style={styles.settingRow} onPress={clearChat}>
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.error + '20' }]}>
                                    <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        Clear Chat History
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Delete all saved chats
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Server Connection */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            SERVER
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <TouchableOpacity
                                style={styles.settingRow}
                                onPress={checkHealth}
                                disabled={isChecking}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                                    {isChecking ? (
                                        <ActivityIndicator color={theme.colors.primary} size="small" />
                                    ) : (
                                            <Ionicons name="refresh" size={20} color={theme.colors.primary} />
                                    )}
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        Reload Connection
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        {healthStatus ? 'Connected' : error ? 'Disconnected' : 'Tap to check'}
                                    </Text>
                                </View>
                                <View style={[
                                    styles.statusDot,
                                    { backgroundColor: healthStatus ? theme.colors.success : (error ? theme.colors.error : theme.colors.textMuted) }
                                ]} />
                            </TouchableOpacity>

                            {/* Server Info when connected */}
                            {healthStatus && (
                                <>
                                    <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />
                                    <View style={styles.infoRow}>
                                        <Text style={[styles.infoLabel, { color: theme.colors.textMuted }]}>Model</Text>
                                        <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                                            {healthStatus.model_loaded ? 'Loaded' : 'Not loaded'}
                                        </Text>
                                    </View>
                                    <View style={styles.infoRow}>
                                        <Text style={[styles.infoLabel, { color: theme.colors.textMuted }]}>Knowledge Base</Text>
                                        <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                                            {healthStatus.knowledge_chunks || 0} chunks
                                        </Text>
                                    </View>
                                </>
                            )}
                        </View>
                    </View>

                    {/* Actions */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            FEATURES
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <TouchableOpacity
                                style={styles.actionRow}
                                onPress={() => router.push('/faceswap' as any)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                                    <Ionicons name="people" size={20} color={theme.colors.primary} />
                                </View>
                                <Text style={[styles.actionLabel, { color: theme.colors.text }]}>
                                    Face Swap
                                </Text>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>

                            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                            <TouchableOpacity
                                style={styles.actionRow}
                                onPress={() => router.push('/learning' as any)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.success + '20' }]}>
                                    <Ionicons name="school" size={20} color={theme.colors.success} />
                                </View>
                                <Text style={[styles.actionLabel, { color: theme.colors.text }]}>
                                    AI Learning System
                                </Text>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>

                            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                            <TouchableOpacity
                                style={styles.actionRow}
                                onPress={() => router.push('/analytics' as any)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.accent + '20' }]}>
                                    <Ionicons name="bar-chart" size={20} color={theme.colors.accent} />
                                </View>
                                <Text style={[styles.actionLabel, { color: theme.colors.text }]}>
                                    Analytics Dashboard
                                </Text>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>

                            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

                            <TouchableOpacity
                                style={styles.actionRow}
                                onPress={triggerLearning}
                                disabled={isLearning}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.accent + '20' }]}>
                                    {isLearning ? (
                                        <ActivityIndicator color={theme.colors.accent} size="small" />
                                    ) : (
                                        <Ionicons name="flash" size={20} color={theme.colors.accent} />
                                    )}
                                </View>
                                <Text style={[styles.actionLabel, { color: theme.colors.text }]}>
                                    {isLearning ? 'Learning...' : 'Trigger Learning'}
                                </Text>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Account */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            ACCOUNT
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            {/* AI Personality */}
                            <TouchableOpacity
                                style={styles.settingRow}
                                onPress={() => router.push('/personality' as any)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.colors.accent + '20' }]}>
                                    <Ionicons name="sparkles-outline" size={20} color={theme.colors.accent} />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        AI Personality
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Style, relationship & language
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
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        Profile
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Edit your profile settings
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
                                                message: 'Are you sure you want to logout?',
                                                icon: 'log-out-outline',
                                                iconColor: '#ef4444',
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
                                            <Text style={[styles.settingLabel, { color: theme.colors.error }]}>
                                                Logout
                                            </Text>
                                            <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                                Sign out of your account
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={theme.colors.error} />
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    </View>

                    {/* Support */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            SUPPORT
                        </Text>

                        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <TouchableOpacity
                                style={styles.settingRow}
                                onPress={() => {
                                    const bmcUrl = 'https://www.buymeacoffee.com/' + (process.env.EXPO_PUBLIC_BMC_USERNAME || 'shubhjn');
                                    import('react-native').then(({ Linking }) => Linking.openURL(bmcUrl));
                                }}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: '#FFDD00' + '30' }]}>
                                    <Ionicons name="cafe-outline" size={20} color="#FFDD00" />
                                </View>
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        Buy Me a Coffee ☕
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Support the project
                                    </Text>
                                </View>
                                <Ionicons name="open-outline" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* About & Legal */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            LEGAL & INFO
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
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        About Whisper AI
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Learn more about the app
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
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        Terms of Service
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        Read our terms and conditions
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
                                    <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
                                        Privacy Policy
                                    </Text>
                                    <Text style={[styles.settingHint, { color: theme.colors.textMuted }]}>
                                        How we handle your data
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* About */}
                    <View style={styles.section}>
                        <View style={[styles.aboutCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <View style={[styles.aboutLogo, { backgroundColor: theme.colors.primary + '15' }]}>
                                <Ionicons name="sparkles" size={28} color={theme.colors.primary} />
                            </View>
                            <Text style={[styles.aboutTitle, { color: theme.colors.text }]}>Whisper AI</Text>
                            <Text style={[styles.aboutVersion, { color: theme.colors.textMuted }]}>
                                Version 3.4.5b
                            </Text>
                        </View>
                    </View>

                    {/* Admin Access (only for admins) */}
                    {profile?.is_admin && (
                        <View style={styles.section}>
                            <TouchableOpacity
                                style={[styles.adminButton, { backgroundColor: theme.colors.primary }]}
                                onPress={() => router.push('/admin')}
                            >
                                <Ionicons name="shield-checkmark" size={20} color="#fff" />
                                <Text style={styles.adminButtonText}>Admin Dashboard</Text>
                            </TouchableOpacity>
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
    inputRow: {
        flexDirection: 'row',
        padding: spacing.md,
        gap: spacing.sm,
    },
    serverInput: {
        flex: 1,
        height: 44,
        paddingHorizontal: spacing.md,
        borderRadius: borderRadius.md,
        fontSize: fontSize.sm,
    },
    connectButton: {
        width: 44,
        height: 44,
        borderRadius: borderRadius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderTopWidth: 1,
        gap: spacing.sm,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    infoLabel: {
        fontSize: fontSize.sm,
    },
    infoValue: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        gap: spacing.md,
    },
    actionLabel: {
        flex: 1,
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    aboutCard: {
        alignItems: 'center',
        padding: spacing.xl,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
    },
    aboutLogo: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.sm,
    },
    aboutTitle: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    aboutVersion: {
        fontSize: fontSize.sm,
        marginTop: 2,
    },
    adminButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
        gap: spacing.sm,
    },
    adminButtonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
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
});
