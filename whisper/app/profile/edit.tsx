/**
 * Whisper App - Profile Edit Screen
 * Avatar selection from stock images
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Alert,
    ActivityIndicator,
    Image,
    FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { useAuth } from '@/hooks';

import { STOCK_AVATARS, getRandomAvatarId } from '@/assets/stock/avatars';

export default function ProfileEditScreen() {
    const { theme } = useTheme();
    const { user, profile, refreshProfile, updateProfile } = useAuth();

    const [displayName, setDisplayName] = useState('');
    const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (profile) {
            setDisplayName(profile.display_name || '');
            // Check if profile has a stock avatar ID or assign random
            const avatarUrl = profile.avatar_url;
            if (avatarUrl && avatarUrl.startsWith('stock:')) {
                setSelectedAvatarId(avatarUrl.replace('stock:', ''));
            } else if (!avatarUrl) {
                // Assign random avatar for new users
                setSelectedAvatarId(getRandomAvatarId());
            }
        }
    }, [profile]);

    const getAvatarSource = () => {
        if (selectedAvatarId) {
            const avatar = STOCK_AVATARS.find(a => a.id === selectedAvatarId);
            return avatar?.source;
        }
        return null;
    };

    const handleSave = useCallback(async () => {
        if (!user?.id) {
            Alert.alert('Error', 'User not logged in');
            return;
        }

        if (!displayName.trim()) {
            Alert.alert('Error', 'Display name is required');
            return;
        }

        setSaving(true);
        try {
            const avatarUrl = selectedAvatarId ? `stock:${selectedAvatarId}` : null;

            const success = await updateProfile({
                display_name: displayName.trim(),
                avatar_url: avatarUrl,
            });

            if (success) {
                await refreshProfile();
                Alert.alert('Success', 'Profile updated successfully', [
                    { text: 'OK', onPress: () => router.back() }
                ]);
            } else {
                Alert.alert('Error', 'Failed to update profile. Please try again.');
            }
        } catch (error) {
            console.error('Profile update error:', error);
            Alert.alert('Error', 'Failed to update profile. Please try again.');
        } finally {
            setSaving(false);
        }
    }, [user, displayName, selectedAvatarId, updateProfile, refreshProfile]);

    const handleDeleteAccount = useCallback(() => {
        Alert.alert(
            'Delete Account',
            'Are you sure you want to delete your account? This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        Alert.alert('Not Implemented', 'Account deletion will be added in a future update');
                    }
                }
            ]
        );
    }, []);

    const renderAvatarItem = ({ item }: { item: typeof STOCK_AVATARS[0] }) => {
        const isSelected = selectedAvatarId === item.id;
        return (
            <TouchableOpacity
                style={[
                    styles.avatarItem,
                    isSelected && { borderColor: theme.colors.primary, borderWidth: 3 },
                ]}
                onPress={() => setSelectedAvatarId(item.id)}
            >
                <Image source={item.source} style={styles.avatarImage} />
                {isSelected && (
                    <View style={[styles.checkBadge, { backgroundColor: theme.colors.primary }]}>
                        <Ionicons name="checkmark" size={14} color="#fff" />
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Edit Profile</Text>
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                    {/* Current Avatar */}
                    <View style={styles.avatarSection}>
                        <View style={styles.currentAvatarContainer}>
                            {getAvatarSource() ? (
                                <Image source={getAvatarSource()} style={styles.currentAvatar} />
                            ) : (
                                    <View style={[styles.currentAvatar, { backgroundColor: theme.colors.surface }]}>
                                    <Ionicons name="person" size={48} color={theme.colors.textMuted} />
                                </View>
                            )}
                        </View>
                        <Text style={[styles.avatarHint, { color: theme.colors.textMuted }]}>
                            Select your avatar below
                        </Text>
                    </View>

                    {/* Avatar Selection Grid */}
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: theme.colors.text }]}>Choose Avatar</Text>
                        <FlatList
                            data={STOCK_AVATARS}
                            renderItem={renderAvatarItem}
                            keyExtractor={item => item.id}
                            numColumns={3}
                            scrollEnabled={false}
                            contentContainerStyle={styles.avatarGrid}
                        />
                    </View>

                    {/* Display Name */}
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: theme.colors.text }]}>Display Name *</Text>
                        <TextInput
                            value={displayName}
                            onChangeText={setDisplayName}
                            placeholder="Enter your name"
                            placeholderTextColor={theme.colors.textMuted}
                            style={[
                                styles.input,
                                {
                                    backgroundColor: theme.colors.surface,
                                    borderColor: theme.colors.surfaceBorder,
                                    color: theme.colors.text,
                                }
                            ]}
                        />
                    </View>

                    {/* Email (Read-only) */}
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: theme.colors.text }]}>Email</Text>
                        <View style={[
                            styles.input,
                            {
                                backgroundColor: theme.colors.surface,
                                borderColor: theme.colors.surfaceBorder,
                                opacity: 0.6,
                            }
                        ]}>
                            <Text style={[styles.readOnlyText, { color: theme.colors.textMuted }]}>
                                {profile?.email || 'Not set'}
                            </Text>
                        </View>
                        <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
                            Email cannot be changed
                        </Text>
                    </View>

                    {/* Subscription Status */}
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: theme.colors.text }]}>Subscription</Text>
                        <TouchableOpacity
                            style={[
                                styles.subscriptionCard,
                                {
                                    backgroundColor: theme.colors.surface,
                                    borderColor: theme.colors.surfaceBorder,
                                }
                            ]}
                            onPress={() => router.push('/subscription')}
                        >
                            <View style={styles.subscriptionInfo}>
                                <Text style={[styles.tierName, { color: theme.colors.text }]}>
                                    {profile?.subscription_tier === 'pro' ? '✨ Pro' : '🆓 Free'}
                                </Text>
                                <Text style={[styles.tokensInfo, { color: theme.colors.textMuted }]}>
                                    {profile?.tokens_used || 0} / {profile?.tokens_limit || 100} tokens used
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {/* Save Button */}
                    <TouchableOpacity
                        onPress={handleSave}
                        disabled={saving}
                        style={[
                            styles.saveButton,
                            { backgroundColor: theme.colors.primary }
                        ]}
                    >
                        {saving ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <>
                                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                                <Text style={styles.saveButtonText}>Save Changes</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    {/* Delete Account */}
                    <TouchableOpacity
                        onPress={handleDeleteAccount}
                        style={styles.deleteButton}
                    >
                        <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
                        <Text style={[styles.deleteButtonText, { color: theme.colors.error }]}>
                            Delete Account
                        </Text>
                    </TouchableOpacity>
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: fontSize.xl,
        fontWeight: '600',
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.lg,
    },
    avatarSection: {
        alignItems: 'center',
        paddingVertical: spacing.lg,
    },
    currentAvatarContainer: {
        position: 'relative',
    },
    currentAvatar: {
        width: 100,
        height: 100,
        borderRadius: 50,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarHint: {
        marginTop: spacing.sm,
        fontSize: fontSize.sm,
    },
    avatarGrid: {
        gap: spacing.md,
    },
    avatarItem: {
        flex: 1,
        aspectRatio: 1,
        margin: spacing.xs,
        borderRadius: borderRadius.lg,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'transparent',
        position: 'relative',
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    checkBadge: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    field: {
        marginBottom: spacing.lg,
    },
    label: {
        fontSize: fontSize.md,
        fontWeight: '600',
        marginBottom: spacing.xs,
    },
    input: {
        borderWidth: 1,
        borderRadius: borderRadius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        fontSize: fontSize.md,
    },
    readOnlyText: {
        fontSize: fontSize.md,
    },
    hint: {
        fontSize: fontSize.xs,
        marginTop: spacing.xs,
    },
    subscriptionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderRadius: borderRadius.md,
        padding: spacing.md,
    },
    subscriptionInfo: {
        gap: 4,
    },
    tierName: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    tokensInfo: {
        fontSize: fontSize.sm,
    },
    saveButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
        marginTop: spacing.md,
        gap: spacing.xs,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        marginTop: spacing.xl,
        marginBottom: spacing.xxl,
        gap: spacing.xs,
    },
    deleteButtonText: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
});
