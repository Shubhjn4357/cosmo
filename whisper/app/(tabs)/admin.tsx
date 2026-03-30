import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../constants/theme';
import { spacing, fontSize, borderRadius } from '../../constants/theme';
import WhisperAPI from '../../services/api';
import { useToast } from '@/components/Toast';
import { UserManagement } from '@/components/Admin/UserManagement';
import { SubscriptionManagement } from '@/components/Admin/SubscriptionManagement';
import { ModelManagement } from '@/components/Admin/ModelManagement';

interface Analytics {
    analytics: {
        uptime_seconds: number;
        uptime_formatted: string;
        total_requests: number;
        chat_requests: number;
        image_requests: number;
        knowledge_added: number;
        errors: number;
        avg_response_time_ms: number;
        requests_per_minute: number;
    };
    system: {
        cpu_percent: number;
        memory_used_gb: number;
        memory_total_gb: number;
        memory_percent: number;
    };
    model: {
        parameters: number;
        parameters_formatted: string;
        loaded: boolean;
    };
    knowledge: {
        total_chunks?: number;
    };
    status: {
        server: string;
        model_loaded: boolean;
        tokenizer_loaded: boolean;
        vectordb_loaded: boolean;
        is_training: boolean;
        daemon_running: boolean;
    };
}

export default function AdminScreen() {
    const { theme } = useTheme();
    const toast = useToast();
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [checkingAuth, setCheckingAuth] = useState(true);
    const [analytics, setAnalytics] = useState<Analytics | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [serverUrl, setServerUrl] = useState('');
    const [generatorRunning, setGeneratorRunning] = useState(false);
    const [services, setServices] = useState({
        horde: true,
        huggingface: false,
        faceswap: true,
        tts: true,
        vision: true,
    });
    const [showServices, setShowServices] = useState(false);
    const [showModels, setShowModels] = useState(false);
    const [showUsers, setShowUsers] = useState(false);
    const [showSubscriptions, setShowSubscriptions] = useState(false);
    const [adminToken, setAdminToken] = useState('admin-temp-token');


    useEffect(() => {
        checkAuth();
        loadServerUrl();
    }, []);

    useEffect(() => {
        if (isLoggedIn) {
            fetchAnalytics();
            fetchSettings();
            const interval = setInterval(fetchAnalytics, 30000); // Refresh every 30s
            return () => clearInterval(interval);
        }
    }, [isLoggedIn]);

    const loadServerUrl = async () => {
        const url = await AsyncStorage.getItem('serverUrl');
        setServerUrl(url || 'https://shubhjn-whisper-ai.hf.space');
    };

    const saveServerUrl = async (url: string) => {
        await AsyncStorage.setItem('serverUrl', url);
        setServerUrl(url);
        toast.success('Saved', 'Server URL updated');
    };

    const checkAuth = async () => {
        try {
            const token = await AsyncStorage.getItem('adminToken');
            if (token) {
                // Verify token is still valid
                const response = await fetch(`${serverUrl}/api/auth/verify`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.ok) {
                    setIsLoggedIn(true);
                }
            }
        } catch (e) {
            // Token invalid or expired
        }
        setCheckingAuth(false);
    };

    const login = async () => {
        if (!username || !password) {
            toast.error('Error', 'Please enter username and password');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`${serverUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.success && data.token) {
                await AsyncStorage.setItem('adminToken', data.token);
                setIsLoggedIn(true);
                setPassword('');
            } else {
                toast.error('Login Failed', data.message || 'Invalid credentials');
            }
        } catch (e) {
            toast.error('Error', 'Could not connect to server');
        }
        setLoading(false);
    };

    const logout = async () => {
        await AsyncStorage.removeItem('adminToken');
        setIsLoggedIn(false);
        setAnalytics(null);
    };

    const fetchAnalytics = async () => {
        try {
            const token = await AsyncStorage.getItem('adminToken');
            const response = await fetch(`${serverUrl}/api/admin/analytics`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                setAnalytics(data);
            }
        } catch (e) {
            console.error('Failed to fetch analytics:', e);
        }
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchAnalytics();
        await fetchSettings();
        setRefreshing(false);
    };

    const fetchSettings = async () => {
        // Settings endpoint doesn't exist on server
        // try {
        //     const response = await fetch(`${serverUrl}/api/settings`);
        //     const data = await response.json();
        // } catch (e) {
        //     // console.log('Could not fetch settings');
        // }
    };



    const startGenerator = async () => {
        try {
            const token = await AsyncStorage.getItem('adminToken');
            const response = await fetch(`${serverUrl}/api/admin/generator/start`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            data.success ? toast.success('Started', data.message) : toast.error('Error', data.message);
            if (data.success) setGeneratorRunning(true);
        } catch (e) {
            toast.error('Error', 'Could not start generator');
        }
    };

    const stopGenerator = async () => {
        try {
            const token = await AsyncStorage.getItem('adminToken');
            const response = await fetch(`${serverUrl}/api/admin/generator/stop`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            data.success ? toast.success('Stopped', data.message) : toast.error('Error', data.message);
            if (data.success) setGeneratorRunning(false);
        } catch (e) {
            toast.error('Error', 'Could not stop generator');
        }
    };

    const startTraining = async (steps: number = 100) => {
        try {
            const token = await AsyncStorage.getItem('adminToken');
            const response = await fetch(`${serverUrl}/api/admin/training/start?steps=${steps}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            data.success ? toast.success('Started', data.message) : toast.error('Error', data.message);
            fetchAnalytics();
        } catch (e) {
            toast.error('Error', 'Could not start training');
        }
    };

    const stopTraining = async () => {
        try {
            const token = await AsyncStorage.getItem('adminToken');
            const response = await fetch(`${serverUrl}/api/admin/training/stop`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            data.success ? toast.success('Stopped', data.message) : toast.error('Error', data.message);
            fetchAnalytics();
        } catch (e) {
            toast.error('Error', 'Could not stop training');
        }
    };

    const toggleService = async (service: keyof typeof services) => {
        try {
            const token = await AsyncStorage.getItem('adminToken');
            const newValue = !services[service];
            const response = await fetch(`${serverUrl}/api/admin/services/${service}/toggle`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled: newValue })
            });
            const data = await response.json();
            if (data.success) {
                setServices(prev => ({ ...prev, [service]: newValue }));
                toast.success('Updated', `${service} ${newValue ? 'enabled' : 'disabled'}`);
            }
        } catch (e) {
            toast.error('Error', 'Could not toggle service');
        }
    };

    if (checkingAuth) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    // Login Screen
    if (!isLoggedIn) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <View style={styles.loginContainer}>
                    <Ionicons name="shield-checkmark" size={64} color={theme.colors.primary} />
                    <Text style={[styles.title, { color: theme.colors.text }]}>Admin Login</Text>
                    
                    <TextInput
                        style={[styles.input, { 
                            backgroundColor: theme.colors.surface,
                            color: theme.colors.text,
                            borderColor: theme.colors.surfaceBorder
                        }]}
                        placeholder="Username"
                        placeholderTextColor={theme.colors.textSecondary}
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                    />
                    
                    <TextInput
                        style={[styles.input, { 
                            backgroundColor: theme.colors.surface,
                            color: theme.colors.text,
                            borderColor: theme.colors.surfaceBorder
                        }]}
                        placeholder="Password"
                        placeholderTextColor={theme.colors.textSecondary}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />
                    
                    <TouchableOpacity
                        style={[styles.loginButton, { backgroundColor: theme.colors.primary }]}
                        onPress={login}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.loginButtonText}>Login</Text>
                        )}
                    </TouchableOpacity>

                    <View style={styles.serverUrlContainer}>
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>Server URL</Text>
                        <TextInput
                            style={[styles.input, { 
                                backgroundColor: theme.colors.surface,
                                color: theme.colors.text,
                                borderColor: theme.colors.surfaceBorder
                            }]}
                            value={serverUrl}
                            onChangeText={setServerUrl}
                            onBlur={() => saveServerUrl(serverUrl)}
                            placeholder="https://shubhjn-whisper-ai.hf.space"
                            placeholderTextColor={theme.colors.textSecondary}
                        />
                    </View>
                </View>
            </View>
        );
    }

    // Admin Dashboard
    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
        >
            <View style={styles.header}>
                <Text style={[styles.title, { color: theme.colors.text }]}>Admin Dashboard</Text>
                <TouchableOpacity onPress={logout}>
                    <Ionicons name="log-out-outline" size={24} color={theme.colors.error} />
                </TouchableOpacity>
            </View>

            {/* Server Status */}
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Server Status</Text>
                <View style={styles.statusRow}>
                    <View style={[styles.statusIndicator, { 
                        backgroundColor: analytics?.status.server === 'running' ? '#4CAF50' : '#f44336' 
                    }]} />
                    <Text style={[styles.statusText, { color: theme.colors.text }]}>
                        {analytics?.status.server === 'running' ? 'Online' : 'Offline'}
                    </Text>
                    <Text style={[styles.uptimeText, { color: theme.colors.textSecondary }]}>
                        Uptime: {analytics?.analytics.uptime_formatted || '-'}
                    </Text>
                </View>
            </View>

            {/* System Resources */}
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]}>System Resources</Text>
                <View style={styles.metricsGrid}>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.system.cpu_percent || 0}%
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>CPU</Text>
                    </View>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.system.memory_percent || 0}%
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>Memory</Text>
                    </View>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.system.memory_used_gb || 0}/{analytics?.system.memory_total_gb || 16}GB
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>RAM Used</Text>
                    </View>
                </View>
            </View>

            {/* Model Info */}
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Model</Text>
                <View style={styles.metricsGrid}>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.model.parameters_formatted || '0'}
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>Parameters</Text>
                    </View>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.knowledge.total_chunks || 0}
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>Knowledge Chunks</Text>
                    </View>
                </View>
            </View>

            {/* Request Analytics */}
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Analytics</Text>
                <View style={styles.metricsGrid}>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.analytics.total_requests || 0}
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>Total Requests</Text>
                    </View>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.analytics.avg_response_time_ms || 0}ms
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>Avg Response</Text>
                    </View>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.analytics.chat_requests || 0}
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>Chat Requests</Text>
                    </View>
                    <View style={styles.metricItem}>
                        <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
                            {analytics?.analytics.errors || 0}
                        </Text>
                        <Text style={[styles.metricLabel, { color: theme.colors.textSecondary }]}>Errors</Text>
                    </View>
                </View>
            </View>

            {/* Generator Controls */}
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Data Generator</Text>
                <View style={styles.buttonRow}>
                    <TouchableOpacity
                        style={[styles.actionButton, styles.buttonFlex, {
                            backgroundColor: theme.colors.primary
                        }]}
                        onPress={startGenerator}
                        disabled={generatorRunning}
                    >
                        <Ionicons name="play" size={18} color="#fff" />
                        <Text style={styles.actionButtonText}>Start</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.actionButton, styles.buttonFlex, {
                            backgroundColor: theme.colors.error
                        }]}
                        onPress={stopGenerator}
                        disabled={!generatorRunning}
                    >
                        <Ionicons name="stop" size={18} color="#fff" />
                        <Text style={styles.actionButtonText}>Stop</Text>
                    </TouchableOpacity>
                </View>
                <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                    {generatorRunning ? '● Running' : '○ Stopped'} — Generates training data using Gemini API
                </Text>
            </View>

            {/* Training Controls */}
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Training Controls</Text>
                <View style={styles.buttonRow}>
                    <TouchableOpacity
                        style={[styles.actionButton, styles.buttonFlex, {
                            backgroundColor: analytics?.status.is_training ? theme.colors.textMuted : theme.colors.primary
                        }]}
                        onPress={() => startTraining(100)}
                        disabled={analytics?.status.is_training}
                    >
                        <Ionicons name="school" size={18} color="#fff" />
                        <Text style={styles.actionButtonText}>Train (100)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.actionButton, styles.buttonFlex, {
                            backgroundColor: analytics?.status.is_training ? theme.colors.error : theme.colors.textMuted
                        }]}
                        onPress={stopTraining}
                        disabled={!analytics?.status.is_training}
                    >
                        <Ionicons name="stop" size={18} color="#fff" />
                        <Text style={styles.actionButtonText}>Stop</Text>
                    </TouchableOpacity>
                </View>
                <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                    {analytics?.status.is_training ? '● Training in progress' : '○ Not training'} — Start model training with 100 steps
                </Text>
            </View>

            {/* Service Control */}
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <TouchableOpacity
                    onPress={() => setShowServices(!showServices)}
                    style={styles.expandHeader}
                >
                    <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Service Control</Text>
                    <Ionicons
                        name={showServices ? "chevron-up" : "chevron-down"}
                        size={24}
                        color={theme.colors.text}
                    />
                </TouchableOpacity>

                {showServices && (
                    <View style={styles.servicesContainer}>
                        {Object.entries(services).map(([service, enabled]) => (
                            <View key={service} style={styles.serviceRow}>
                                <View style={styles.serviceInfo}>
                                    <Ionicons
                                        name={enabled ? "checkmark-circle" : "close-circle"}
                                        size={24}
                                        color={enabled ? "#4CAF50" : "#f44336"}
                                    />
                                    <Text style={[styles.serviceName, { color: theme.colors.text }]}>
                                        {service.toUpperCase()}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    onPress={() => toggleService(service as keyof typeof services)}
                                    style={[styles.toggleButton, {
                                        backgroundColor: enabled ? theme.colors.primary : theme.colors.textMuted
                                    }]}
                                >
                                    <Text style={styles.toggleButtonText}>
                                        {enabled ? 'ON' : 'OFF'}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>
                )}
            </View>

            {/* Server URL Config */}
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Server Configuration</Text>
                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>API URL</Text>
                <TextInput
                    style={[styles.input, { 
                        backgroundColor: theme.colors.background,
                        color: theme.colors.text,
                        borderColor: theme.colors.surfaceBorder
                    }]}
                    value={serverUrl}
                    onChangeText={setServerUrl}
                    onBlur={() => saveServerUrl(serverUrl)}
                />
            </View>

            <View style={{ height: 100 }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: spacing.md,
    },
    loginContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
    },
    title: {
        fontSize: fontSize.xl,
        fontWeight: 'bold',
        marginVertical: spacing.lg,
    },
    input: {
        width: '100%',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        marginBottom: spacing.md,
        fontSize: fontSize.md,
    },
    loginButton: {
        width: '100%',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        alignItems: 'center',
        marginTop: spacing.sm,
    },
    loginButtonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    serverUrlContainer: {
        width: '100%',
        marginTop: spacing.xl,
    },
    label: {
        fontSize: fontSize.sm,
        marginBottom: spacing.xs,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.md,
        paddingTop: spacing.lg,
    },
    card: {
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        marginBottom: spacing.md,
    },
    cardTitle: {
        fontSize: fontSize.md,
        fontWeight: '600',
        marginBottom: spacing.md,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusIndicator: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginRight: spacing.sm,
    },
    statusText: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    uptimeText: {
        marginLeft: 'auto',
        fontSize: fontSize.sm,
    },
    metricsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    metricItem: {
        width: '48%',
        padding: spacing.sm,
        marginBottom: spacing.sm,
    },
    metricValue: {
        fontSize: fontSize.lg,
        fontWeight: 'bold',
    },
    metricLabel: {
        fontSize: fontSize.xs,
        marginTop: spacing.xs,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        gap: spacing.sm,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.xs,
    },
    buttonFlex: {
        flex: 1,
    },
    actionButtonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    hint: {
        fontSize: fontSize.xs,
        marginTop: spacing.sm,
        textAlign: 'center',
    },
    expandHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    servicesContainer: {
        marginTop: spacing.md,
        gap: spacing.sm,
    },
    serviceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.sm,
        borderRadius: borderRadius.md,
        backgroundColor: 'rgba(0,0,0,0.05)',
    },
    serviceInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    serviceName: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    toggleButton: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: borderRadius.sm,
        minWidth: 50,
        alignItems: 'center',
    },
    toggleButtonText: {
        color: '#FFFFFF',
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
});
