/**
 * Whisper App - Profile Screen
 * User profile display and editing
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { modelLoader, LoadedModel } from '@/services/ModelLoader';

export default function ProfileScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const { user, profile, updateProfile, signOut } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [displayName, setDisplayName] = useState(profile?.display_name || '');
    const [loadedModel, setLoadedModel] = useState<LoadedModel | null>(null);
    const [loadingModel, setLoadingModel] = useState(false);

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!user) {
            router.push('/auth/login');
        }
    }, [user, router]);

    const handleSave = async () => {
        if (!displayName.trim()) {
            Alert.alert('Error', 'Display name cannot be empty');
            return;
        }

        setIsSaving(true);
        try {
            const success = await updateProfile({ display_name: displayName.trim() });
            if (success) {
                setIsEditing(false);
                Alert.alert('Success', 'Profile updated successfully');
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleLogout = () => {
        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
                        await signOut();
                        router.replace('/auth/login');
                    },
                },
            ]
        );
    };

    const handleLoadModel = async () => {
        try {
            setLoadingModel(true);
            const model = await modelLoader.loadModel();
            if (model) {
                setLoadedModel(model);
                Alert.alert('Success', `Model loaded: ${model.name}`);
            }
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to load model');
        } finally {
            setLoadingModel(false);
        }
    };

    const handleClearModel = () => {
        Alert.alert(
            'Clear Model',
            'Are you sure you want to clear the loaded model?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: async () => {
                        await modelLoader.clearLoadedModel();
                        setLoadedModel(null);
                        Alert.alert('Success', 'Model cleared');
                    },
                },
            ]
        );
    };

    // Load current model on mount
    React.useEffect(() => {
        (async () => {
            const model = await modelLoader.getLoadedModel();
            setLoadedModel(model);
        })();
    }, []);

    return (
        <LinearGradient
            colors={[theme.colors.background, theme.colors.surface]}
            style={styles.container}
        >
            <SafeAreaView style={styles.safeArea}>
                <ScrollView showsVerticalScrollIndicator={false}>
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                            <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.title, { color: theme.colors.text }]}>Profile</Text>
                        <View style={{ width: 40 }} />
                    </View>

                    {/* Avatar */}
                    <View style={styles.avatarSection}>
                        <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
                            <Text style={styles.avatarText}>
                                {profile?.display_name?.[0]?.toUpperCase() || 'U'}
                            </Text>
                        </View>
                    </View>

                    {/* Profile Info */}
                    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
                            Account Information
                        </Text>

                        {/* Display Name */}
                        <View style={styles.field}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>
                                Display Name
                            </Text>
                            {isEditing ? (
                                <TextInput
                                    style={[styles.input, { backgroundColor: theme.colors.surfaceLight, color: theme.colors.text, borderColor: theme.colors.surfaceBorder }]}
                                    value={displayName}
                                    onChangeText={setDisplayName}
                                    placeholder="Enter your name"
                                    placeholderTextColor={theme.colors.textMuted}
                                />
                            ) : (
                                <Text style={[styles.fieldValue, { color: theme.colors.text }]}>
                                    {profile?.display_name || 'Not set'}
                                </Text>
                            )}
                        </View>

                        {/* Email */}
                        <View style={styles.field}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>Email</Text>
                            <Text style={[styles.fieldValue, { color: theme.colors.text }]}>
                                {profile?.email || 'Not set'}
                            </Text>
                        </View>

                        {/* Member Since */}
                        <View style={styles.field}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.textMuted }]}>Member Since</Text>
                            <Text style={[styles.fieldValue, { color: theme.colors.text }]}>
                                {profile?.created_at
                                    ? new Date(profile.created_at).toLocaleDateString()
                                    : 'Unknown'}
                            </Text>
                        </View>

                        {/* Edit/Save Button */}
                        {isEditing ? (
                            <View style={styles.editActions}>
                                <TouchableOpacity
                                    style={[styles.cancelBtn, { borderColor: theme.colors.surfaceBorder }]}
                                    onPress={() => {
                                        setDisplayName(profile?.display_name || '');
                                        setIsEditing(false);
                                    }}
                                >
                                    <Text style={[styles.cancelBtnText, { color: theme.colors.textMuted }]}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.saveBtn, { backgroundColor: theme.colors.primary }]}
                                    onPress={handleSave}
                                    disabled={isSaving}
                                >
                                    {isSaving ? (
                                        <ActivityIndicator color="#000" size="small" />
                                    ) : (
                                        <Text style={styles.saveBtnText}>Save</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <TouchableOpacity
                                style={[styles.editBtn, { borderColor: theme.colors.primary }]}
                                onPress={() => setIsEditing(true)}
                            >
                                <Ionicons name="pencil" size={16} color={theme.colors.primary} />
                                <Text style={[styles.editBtnText, { color: theme.colors.primary }]}>Edit Profile</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Model Settings */}
                    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
                            Model Settings
                        </Text>

                        {loadedModel ? (
                            <>
                                <View style={styles.modelInfo}>
                                    <Ionicons name="cube" size={24} color={theme.colors.primary} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.modelName, { color: theme.colors.text }]}>
                                            {loadedModel.name}
                                        </Text>
                                        <Text style={[styles.modelDetails, { color: theme.colors.textMuted }]}>
                                            {loadedModel.format.toUpperCase()} • {modelLoader.formatSize(loadedModel.size)}
                                        </Text>
                                    </View>
                                    <TouchableOpacity onPress={handleClearModel}>
                                        <Ionicons name="close-circle" size={24} color={theme.colors.error} />
                                    </TouchableOpacity>
                                </View>
                                <View style={[styles.modelTag, { backgroundColor: theme.colors.primary + '20' }]}>
                                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} />
                                    <Text style={[styles.modelTagText, { color: theme.colors.primary }]}>
                                        Using Local Model
                                    </Text>
                                </View>
                            </>
                        ) : (
                            <>
                                <Text style={[styles.modelHint, { color: theme.colors.textMuted }]}>
                                    Load a custom model (.pte or .gguf) from your device to use for local inference
                                </Text>
                                <TouchableOpacity
                                    style={[styles.loadModelBtn, { backgroundColor: theme.colors.primary }]}
                                    onPress={handleLoadModel}
                                    disabled={loadingModel}
                                >
                                    {loadingModel ? (
                                        <ActivityIndicator color="#000" size="small" />
                                    ) : (
                                        <>
                                            <Ionicons name="download" size={20} color="#000" />
                                            <Text style={styles.loadModelText}>Load Custom Model</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </>
                        )}
                    </View>

                    {/* Sign Out */}
                    <TouchableOpacity
                        style={[styles.logoutBtn, { borderColor: theme.colors.error }]}
                        onPress={handleLogout}
                    >
                        <Ionicons name="log-out-outline" size={20} color={theme.colors.error} />
                        <Text style={[styles.logoutText, { color: theme.colors.error }]}>Sign Out</Text>
                    </TouchableOpacity>
                </ScrollView>
            </SafeAreaView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg },
    backBtn: { padding: spacing.xs },
    title: { fontSize: fontSize.xl, fontWeight: '700' },
    avatarSection: { alignItems: 'center', marginBottom: spacing.xl },
    avatar: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
    avatarText: { color: '#000', fontSize: 36, fontWeight: '700' },
    card: { marginHorizontal: spacing.lg, marginBottom: spacing.lg, padding: spacing.lg, borderRadius: borderRadius.lg, borderWidth: 1 },
    cardTitle: { fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
    field: { marginBottom: spacing.md },
    fieldLabel: { fontSize: fontSize.xs, marginBottom: 4 },
    fieldValue: { fontSize: fontSize.md },
    input: { borderWidth: 1, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.md },
    editActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
    cancelBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, alignItems: 'center' },
    cancelBtnText: { fontSize: fontSize.sm, fontWeight: '600' },
    saveBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: borderRadius.md, alignItems: 'center' },
    saveBtnText: { color: '#000', fontSize: fontSize.sm, fontWeight: '600' },
    editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, gap: spacing.xs, marginTop: spacing.sm },
    editBtnText: { fontSize: fontSize.sm, fontWeight: '600' },
    modelInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    modelName: { fontSize: fontSize.md, fontWeight: '600' },
    modelDetails: { fontSize: fontSize.xs, marginTop: 2 },
    modelTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: borderRadius.md },
    modelTagText: { fontSize: fontSize.xs, fontWeight: '600' },
    modelHint: { fontSize: fontSize.sm, marginBottom: spacing.md, lineHeight: 20 },
    loadModelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md, gap: spacing.xs },
    loadModelText: { color: '#000', fontSize: fontSize.sm, fontWeight: '600' },
    logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.lg, marginBottom: spacing.xxl, paddingVertical: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, gap: spacing.sm },
    logoutText: { fontSize: fontSize.md, fontWeight: '600' },
});
