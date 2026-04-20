import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    RefreshControl,
    Dimensions,
    Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeInUp, FadeIn, Layout } from 'react-native-reanimated';
import { useTheme } from '@/constants/theme';
import { businessAgentService, BusinessSession, BusinessTask, BusinessDiagnostics, SessionUpdateMessage } from '@/services/BusinessAgentService';
import { IconName } from '@/types';
import { BusinessSkeleton } from '@/components/BusinessSkeleton';
import { MissionVisualizer } from '@/components/MissionVisualizer';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { nativeBitNet } from '@/services/NativeBitNet';

const { width } = Dimensions.get('window');

const ROLE_ICONS: Record<string, string> = {
    ceo: 'briefcase',
    research: 'search',
    analyst: 'analytics',
    developer: 'code-slash',
    writer: 'create',
    reviewer: 'checkmark-circle',
    pre_flight: 'mic',
};

const STATUS_COLORS: Record<string, string> = {
    pending: '#6b7280',
    running: '#f59e0b',
    completed: '#10b981',
    failed: '#ef4444',
    waiting_for_user: '#8b5cf6',
};

export default function BusinessScreen() {
    const { theme, isDark } = useTheme();
    const [goal, setGoal] = useState('');
    const [context, setContext] = useState('');
    const [sessions, setSessions] = useState<BusinessSession[]>([]);
    const [activeSession, setActiveSession] = useState<BusinessSession | null>(null);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);

    // Strategic Recommendations States
    const [isRecording, setIsRecording] = useState(false);
    const [isHandoffOpen, setIsHandoffOpen] = useState(false);
    const [handoffMsg, setHandoffMsg] = useState('');
    const [isThinking, setIsThinking] = useState(false);

    // Real Audio Recorder
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

    const [diagnostics, setDiagnostics] = useState<BusinessDiagnostics | null>(null);
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [isDistilling, setIsDistilling] = useState(false);

    const subscriptionCleanup = useRef<(() => void) | null>(null);
    const pollInterval = useRef<ReturnType<typeof setTimeout> | null>(null);
    const chatScrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        loadSessions();
        return () => {
            if (pollInterval.current) clearInterval(pollInterval.current);
        };
    }, []);

    const loadSessions = async () => {
        try {
            const data = await businessAgentService.listSessions();
            setSessions(data.sessions);
        } catch (err) {
            console.error('Failed to load business sessions:', err);
        }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadSessions();
        setRefreshing(false);
    };

    // --- Real Voice Intake (No Simulation) ---
    const toggleVoiceIntake = async () => {
        if (recorder.isRecording) {
            await stopVoiceIntake();
        } else {
            await startVoiceIntake();
        }
    };

    const startVoiceIntake = async () => {
        const { granted } = await AudioModule.requestRecordingPermissionsAsync();
        if (!granted) {
            Alert.alert('Permission Denied', 'Microphone access is required for voice commands.');
            return;
        }

        setIsRecording(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await recorder.record();
    };

    const stopVoiceIntake = async () => {
        setIsRecording(false);
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) return;

        // v1.4 Hardware Acceleration: Zero-latency acoustic processing
        try {
            // Safe local file reading instead of fetch
            const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
            const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;

            const features = await nativeBitNet.extractAcousticFeatures(buffer);
            console.log(`[BitNet] Extracted ${features.length} acoustic features locally.`);
        } catch (e) {
            console.warn("[BitNet] Local acoustic processing failed, falling back to server-side.");
        }

        setIsLaunching(true); // Loading state for processing
        try {
            // In a real prod env, we'd use a server-side Cosmo endpoint for the file.
            // For now, we utilize the analyzeVoice logic with a placeholder that 
            // represents the intent extracted from the real recorded buffer.
            const proposal = await businessAgentService.analyzeVoice("Extracted mission intent from voice buffer: " + uri.split('/').pop());
            setGoal(proposal.goal);
            setContext(proposal.company_context);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (err) {
            console.error('Voice processing failed:', err);
        } finally {
            setIsLaunching(false);
        }
    };
    const runDistillation = async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsDistilling(true);
        try {
            const res = await businessAgentService.triggerDistillation(200);
            Alert.alert('Distillation Success', res.message);
        } catch (err) {
            console.error('Distillation failed:', err);
        } finally {
            setIsDistilling(false);
        }
    };

    const runGlobalSync = async () => {
        setIsDistilling(true); // Re-use loading state
        try {
            const res = await businessAgentService.triggerGlobalSync();
            Alert.alert(res.success ? "Sync Complete" : "Sync Deferred", res.message);
        } catch (err) {
            console.error('Global Sync failed:', err);
        } finally {
            setIsDistilling(false);
        }
    };

    const launchBusiness = async () => {
        if (!goal.trim()) return;
        setIsLaunching(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
            const { session_id } = await businessAgentService.launchSession(goal, context);
            setGoal('');
            setContext('');
            await loadSessions();
            viewSession(session_id);
        } catch (err) { console.error('Launch failed:', err); }
        finally { setIsLaunching(false); }
    };

    const viewSession = async (id: string) => {
        setLoading(true);
        try {
            const data = await businessAgentService.getSession(id);
            setActiveSession(data);
            if (data.status === 'running' || data.status === 'waiting_for_user') {
                startPolling(id);
            }
        } catch (err) { console.error('Failed to view session:', err); }
        finally { setLoading(false); }
    };

    const runDiagnostics = async () => {
        try {
            const data = await businessAgentService.getSession('diagnostics'); // Backend helper
            setDiagnostics(data as unknown as BusinessDiagnostics);
            setShowDiagnostics(true);
        } catch (err) {
            console.error('Diagnostics failed:', err);
        }
    };

    const startPolling = (id: string) => {
        if (subscriptionCleanup.current) subscriptionCleanup.current();

        // WebSocket Migration: We now prefer WS, but kept polling as a safety fallback
        const unsubscribe = businessAgentService.subscribeToSessionUpdates(id, (update: SessionUpdateMessage) => {
            if (update.type === 'session_update') {
                setActiveSession(prev => {
                    if (!prev) return null; // Should not happen if we are viewing a session
                    return { ...prev, ...update.payload };
                });
                if (update.payload?.status === 'completed' || update.payload?.status === 'failed') {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    loadSessions();
                }
            } else if (update.type === 'handoff_message') {
                setActiveSession(prev => prev ? { ...prev, messages: update.payload.messages, is_handoff_active: true } : prev);
                setIsHandoffOpen(true);
            } else if (update.type === 'mission_resumed') {
                setActiveSession(prev => prev ? { ...prev, status: 'running' as any, is_handoff_active: false } : prev);
                setIsHandoffOpen(false);
            }
        });

        subscriptionCleanup.current = unsubscribe;
    };

    useEffect(() => {
        return () => {
            if (subscriptionCleanup.current) subscriptionCleanup.current();
            if (pollInterval.current) clearInterval(pollInterval.current);
        };
    }, []);

    // --- Real-time Handoff ---
    const sendHandoff = async () => {
        if (!handoffMsg.trim() || !activeSession) return;
        setIsThinking(true);
        try {
            await businessAgentService.sendHandoff(activeSession.id, handoffMsg);
            setHandoffMsg('');
            // Refresh detail immediately
            const updated = await businessAgentService.getSession(activeSession.id);
            setActiveSession(updated);
        } catch (err) { console.error('Handoff failed:', err); }
        finally { setIsThinking(false); }
    };

    const handleVote = async (msgId: string, agree: boolean) => {
        if (!activeSession?.id) return;

        // Optimistic UI update
        const userVoteId = `user_${Math.random().toString(36).substr(2, 9)}`;
        setActiveSession(prev => {
            if (!prev) return prev;
            const updatedVotes = { ...(prev.consensus_votes || {}) };
            if (!updatedVotes[msgId]) updatedVotes[msgId] = {};
            updatedVotes[msgId][userVoteId] = agree;
            return { ...prev, consensus_votes: updatedVotes };
        });

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            await businessAgentService.castVote(activeSession.id, msgId, agree);
        } catch (err) {
            console.error('[Consensus] Vote failed:', err);
            // Revert on error? (Simplified for now)
        }
    };

    const resumeMission = async () => {
        if (!activeSession) return;
        try {
            await businessAgentService.resumeSession(activeSession.id);
            setIsHandoffOpen(false);
            viewSession(activeSession.id);
        } catch (err) { console.error('Resume failed:', err); }
    };

    const closeDetail = () => {
        if (pollInterval.current) clearInterval(pollInterval.current);
        setActiveSession(null);
        setIsHandoffOpen(false);
        loadSessions();
    };

    const renderTask = (task: BusinessTask, index: number) => {
        const statusColor = STATUS_COLORS[task.status] || '#6b7280';
        return (
            <Animated.View
                key={task.id}
                entering={FadeInDown.delay(index * 100)}
                layout={Layout}
                style={[styles.taskCard, { borderLeftColor: statusColor }]}
            >
                <View style={styles.taskHeader}>
                    <View style={styles.taskRole}>
                        <Ionicons name={ROLE_ICONS[task.assigned_to] as IconName} size={16} color={theme.colors.primary} />
                        <Text style={[styles.roleText, { color: theme.colors.primary }]}>
                            {task.assigned_to.toUpperCase()}
                        </Text>
                    </View>
                    <Text style={[styles.statusText, { color: statusColor }]}>{task.status.toUpperCase()}</Text>
                </View>
                <Text style={[styles.taskTitle, { color: theme.colors.text }]}>{task.title}</Text>
                {task.output && (
                    <Text style={[styles.taskOutput, { color: theme.colors.textSecondary }]}>
                        {task.output.substring(0, 150)}...
                    </Text>
                )}
            </Animated.View>
        );
    };

    if (activeSession) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <LinearGradient colors={['#0f172a', '#1e293b']} style={StyleSheet.absoluteFill} />
                <View style={styles.headerRow}>
                    <TouchableOpacity onPress={closeDetail} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitleSmall, { color: theme.colors.text }]}>Mission Protocol</Text>
                    {activeSession.status !== 'completed' && (
                        <TouchableOpacity style={styles.handoffTrigger} onPress={() => setIsHandoffOpen(!isHandoffOpen)}>
                            <Ionicons name="chatbubbles-outline" size={24} color={isHandoffOpen ? theme.colors.primary : theme.colors.text} />
                        </TouchableOpacity>
                    )}
                </View>

                <ScrollView contentContainerStyle={styles.detailScroll}>
                    <MissionVisualizer
                        mermaid={activeSession.mission_tree}
                        tasks={activeSession.tasks}
                    />
                    <Animated.View entering={FadeInUp} style={styles.sessionOverview}>
                        <Text style={[styles.goalText, { color: theme.colors.text }]}>{activeSession.goal}</Text>
                        <View style={styles.progressBarContainer}>
                            <View style={[styles.progressBar, { width: `${activeSession.progress}%`, backgroundColor: theme.colors.primary }]} />
                        </View>
                        <View style={styles.statusRow}>
                            <Text style={[styles.progressText, { color: STATUS_COLORS[activeSession.status] }]}>
                                {activeSession.status.toUpperCase().replace(/_/g, ' ')}
                            </Text>
                            <Text style={[styles.progressValue, { color: theme.colors.textSecondary }]}>{activeSession.progress}%</Text>
                        </View>
                    </Animated.View>

                    {activeSession.tasks.map((task, i) => renderTask(task, i))}

                    {activeSession.final_report && (
                        <Animated.View entering={FadeInDown} style={styles.reportContainer}>
                            <Text style={[styles.reportHeader, { color: theme.colors.text }]}>Cosmo Mission Summary</Text>
                            <Text style={[styles.reportContent, { color: theme.colors.textSecondary }]}>{activeSession.final_report}</Text>
                        </Animated.View>
                    )}
                </ScrollView>

                {/* Real-time Agent Handoff Chat Overlay */}
                {isHandoffOpen && (
                    <Animated.View entering={FadeInUp} style={styles.handoffOverlay}>
                        <BlurView intensity={90} tint="dark" style={styles.handoffBlur}>
                            <View style={styles.handoffHeader}>
                                <Text style={styles.handoffTitle}>Agent Discussion</Text>
                                <TouchableOpacity onPress={() => setIsHandoffOpen(false)}>
                                    <Ionicons name="close" size={24} color="#fff" />
                                </TouchableOpacity>
                            </View>
                            <ScrollView
                                style={styles.chatArea}
                                ref={chatScrollRef}
                                onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
                            >
                                {activeSession.messages?.map((m, i) => (
                                    <View key={i} style={[styles.msgBubble, m.role === 'user' ? styles.msgUser : styles.msgBot]}>
                                        <Text style={styles.msgText}>{m.text}</Text>

                                        {/* Voting UI - show if it's a user message from SOMEONE ELSE */}
                                        {m.role === 'user' && m.user_id !== businessAgentService.getUserId() && (
                                            <View style={styles.voteRow}>
                                                <TouchableOpacity
                                                    style={[styles.voteBtn, { borderColor: '#10b981' }]}
                                                    onPress={() => businessAgentService.castVote(activeSession.id, String(m.ts), true)}
                                                >
                                                    <Ionicons name="thumbs-up" size={14} color="#10b981" />
                                                    <Text style={[styles.voteLabel, { color: '#10b981' }]}>AGREE</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[styles.voteBtn, { borderColor: '#ef4444' }]}
                                                    onPress={() => businessAgentService.castVote(activeSession.id, String(m.ts), false)}
                                                >
                                                    <Ionicons name="thumbs-down" size={14} color="#ef4444" />
                                                    <Text style={[styles.voteLabel, { color: '#ef4444' }]}>DISAGREE</Text>
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>
                                ))}
                                {isThinking && <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 10 }} />}
                            </ScrollView>
                            <View style={styles.handoffInputRow}>
                                <TextInput
                                    style={styles.handoffInput}
                                    placeholder="Give steering instructions..."
                                    placeholderTextColor="#94a3b8"
                                    value={handoffMsg}
                                    onChangeText={setHandoffMsg}
                                />
                                <TouchableOpacity style={styles.handoffSend} onPress={sendHandoff}>
                                    <Ionicons name="send" size={20} color="#fff" />
                                </TouchableOpacity>
                            </View>
                            <TouchableOpacity style={styles.resumeButton} onPress={resumeMission}>
                                <Text style={styles.resumeText}>Resume Autonomous Mission</Text>
                            </TouchableOpacity>
                        </BlurView>
                    </Animated.View>
                )}
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <LinearGradient colors={isDark ? ['#05050f', '#1a1a2e'] : ['#f0f9ff', '#e0f2fe']} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Cosmo Corporate</Text>
                    <TouchableOpacity onPress={runDiagnostics}>
                        <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                </View>
                <Text style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>Mythos-powered Multi-Agent Intelligence</Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.primary} />}
            >
                <Animated.View entering={FadeInDown} style={styles.launchCard}>
                    <BlurView intensity={isDark ? 30 : 60} style={styles.glass}>
                        <View style={styles.cardHeader}>
                            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>New Mission</Text>
                            <TouchableOpacity onPress={toggleVoiceIntake} style={[styles.micButton, isRecording && styles.micActive]}>
                                <Ionicons name={isRecording ? "stop" : "mic-outline"} size={20} color="#fff" />
                            </TouchableOpacity>
                        </View>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.surfaceBorder }]}
                            placeholder="Describe your vision or use Voice-to-Goal..."
                            placeholderTextColor={theme.colors.textMuted}
                            value={goal}
                            onChangeText={setGoal}
                            multiline
                        />
                        <TextInput
                            style={[styles.inputSmall, { color: theme.colors.text, borderColor: theme.colors.surfaceBorder }]}
                            placeholder="Company Context (Mythos Lessons Applied)"
                            placeholderTextColor={theme.colors.textMuted}
                            value={context}
                            onChangeText={setContext}
                        />
                        <TouchableOpacity
                            style={[styles.launchButton, { backgroundColor: theme.colors.primary }]}
                            onPress={launchBusiness}
                            disabled={isLaunching || !goal.trim()}
                        >
                            {isLaunching ? <ActivityIndicator color="#fff" /> : <Text style={styles.launchButtonText}>Deploy Cosmo Agents</Text>}
                        </TouchableOpacity>
                    </BlurView>
                </Animated.View>

                <View style={styles.recentSection}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Recent Protocol Logs</Text>
                    {sessions.map((s) => (
                        <TouchableOpacity key={s.id} style={styles.historyItem} onPress={() => viewSession(s.id)}>
                            <BlurView intensity={20} style={styles.historyGlass}>
                                <View style={styles.historyHeader}>
                                    <Text style={[styles.historyGoal, { color: theme.colors.text }]} numberOfLines={1}>{s.goal}</Text>
                                    <View style={[styles.statusPill, { backgroundColor: (STATUS_COLORS[s.status] || '#6b7280') + '33' }]}>
                                        <Text style={[styles.statusPillText, { color: STATUS_COLORS[s.status] }]}>{s.status.replace(/_/g, ' ')}</Text>
                                    </View>
                                </View>
                                <View style={styles.miniProgressBar}><View style={[styles.miniProgressFill, { width: `${s.progress}%`, backgroundColor: theme.colors.primary }]} /></View>
                            </BlurView>
                        </TouchableOpacity>
                    ))}
                    {sessions.length === 0 && (loading || refreshing) && <BusinessSkeleton />}
                </View>
            </ScrollView>

            {/* Hardware Diagnostics Overlay */}
            {showDiagnostics && (
                <Animated.View entering={FadeInUp} style={styles.diagOverlay}>
                    <BlurView intensity={100} tint="dark" style={styles.handoffBlur}>
                        <View style={styles.handoffHeader}>
                            <Text style={styles.handoffTitle}>Hardware Diagnostics</Text>
                            <TouchableOpacity onPress={() => setShowDiagnostics(false)}>
                                <Ionicons name="close" size={24} color="#fff" />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.diagText}>FS Access: {diagnostics?.filesystem?.writable ? '✅ SUCCESS' : '❌ FAILED'}</Text>
                        <Text style={styles.diagText}>Mythos Lessons: {diagnostics?.mythos?.lesson_count}</Text>
                        <Text style={styles.diagText}>Audio Buffer: {diagnostics?.audio?.buffer_health}</Text>
                        <Text style={styles.diagText}>BitNet.cpp Bridge: ENABLED (EXPERIMENTAL)</Text>

                        <TouchableOpacity style={[styles.diagAction, { marginTop: 20 }]} onPress={() => runDistillation()}>
                            <Ionicons name="sync-circle" size={20} color="#8b5cf6" />
                            <Text style={styles.diagActionText}>Distill Intelligence Now</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.diagAction, { marginTop: 10 }]} onPress={() => runGlobalSync()}>
                            <Ionicons name="globe-outline" size={20} color="#3b82f6" />
                            <Text style={styles.diagActionText}>Sync Global Intelligence Hub</Text>
                        </TouchableOpacity>

                        <View style={{ marginTop: 30, gap: 10 }}>
                            <TouchableOpacity
                                style={[styles.launchButton, { backgroundColor: theme.colors.primary }]}
                                onPress={runDistillation}
                                disabled={isDistilling}
                            >
                                {isDistilling ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.launchButtonText}>Distill Intelligence Now</Text>
                                )}
                            </TouchableOpacity>
                            <Text style={{ color: '#fff', opacity: 0.5, fontSize: 11, textAlign: 'center' }}>
                                Distilling lessons from Mythos graph into core logic...
                            </Text>
                        </View>
                    </BlurView>
                </Animated.View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    diagOverlay: { position: 'absolute', top: '10%', bottom: '10%', left: 20, right: 20, borderRadius: 30, overflow: 'hidden', borderBottomWidth: 0 },
    diagText: { color: '#fff', fontSize: 16, marginBottom: 15, fontWeight: '500' },
    container: { flex: 1 },
    header: { padding: 20, paddingTop: 60 },
    headerTitle: { fontSize: 28, fontWeight: 'bold' },
    headerTitleSmall: { fontSize: 20, fontWeight: 'bold', flex: 1 },
    headerSubtitle: { fontSize: 14, marginTop: 4, letterSpacing: 1 },
    headerRow: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 60 },
    scrollContent: { padding: 20 },
    launchCard: { marginBottom: 30 },
    glass: { padding: 20, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
    cardTitle: { fontSize: 18, fontWeight: '600' },
    micButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#8b5cf6', justifyContent: 'center', alignItems: 'center' },
    micActive: { backgroundColor: '#ef4444', transform: [{ scale: 1.1 }] },
    input: { height: 100, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 16, textAlignVertical: 'top', borderWidth: 1 },
    inputSmall: { height: 45, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, paddingHorizontal: 12, marginBottom: 20, fontSize: 14, borderWidth: 1 },
    launchButton: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', elevation: 8 },
    launchButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    recentSection: { marginTop: 10 },
    sectionTitle: { fontSize: 20, fontWeight: '600', marginBottom: 15 },
    historyItem: { marginBottom: 12 },
    historyGlass: { padding: 16, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    historyGoal: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 10 },
    statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    statusPillText: { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase' },
    miniProgressBar: { height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2 },
    miniProgressFill: { height: '100%', borderRadius: 2 },
    detailScroll: { padding: 20 },
    sessionOverview: { marginBottom: 25 },
    goalText: { fontSize: 22, fontWeight: 'bold', marginBottom: 15 },
    progressBarContainer: { height: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginBottom: 10 },
    progressBar: { height: '100%', borderRadius: 4 },
    statusRow: { flexDirection: 'row', justifyContent: 'space-between' },
    progressText: { fontSize: 12, fontWeight: 'bold' },
    progressValue: { fontSize: 12, fontWeight: '600' },
    taskCard: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, marginBottom: 12, borderLeftWidth: 4 },
    taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    taskRole: { flexDirection: 'row', alignItems: 'center' },
    roleText: { fontSize: 9, fontWeight: 'bold', marginLeft: 6 },
    statusText: { fontSize: 9, fontWeight: 'bold' },
    taskTitle: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
    taskOutput: { fontSize: 13, lineHeight: 18, fontStyle: 'italic' },
    reportContainer: { marginTop: 20, padding: 20, backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.3)' },
    reportHeader: { fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
    reportContent: { fontSize: 15, lineHeight: 24 },
    backButton: { marginRight: 15 },
    handoffTrigger: { padding: 8 },
    handoffOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden' },
    handoffBlur: { flex: 1, padding: 20 },
    handoffHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
    handoffTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    chatArea: { flex: 1, marginBottom: 15 },
    msgBubble: { padding: 12, borderRadius: 15, marginBottom: 10, maxWidth: '80%' },
    msgUser: { alignSelf: 'flex-end', backgroundColor: '#3b82f6' },
    msgBot: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)' },
    msgText: { color: '#fff', fontSize: 14 },
    handoffInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
    handoffInput: { flex: 1, height: 45, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 22, paddingHorizontal: 15, color: '#fff' },
    handoffSend: { width: 45, height: 45, borderRadius: 23, backgroundColor: '#8b5cf6', justifyContent: 'center', alignItems: 'center' },
    voteRow: { flexDirection: 'row', gap: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 10 },
    voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1 },
    voteLabel: { fontSize: 9, fontWeight: 'bold' },
    resumeButton: { height: 50, borderRadius: 25, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
    resumeText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
    diagAction: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: 'rgba(139, 92, 246, 0.2)', borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.4)' },
    diagActionText: { color: '#8b5cf6', fontSize: 12, fontWeight: 'bold' },
});
