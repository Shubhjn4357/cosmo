/**
 * Whisper App - AuthGate Component
 * Shows login modal for features that require authentication.
 * Allows wrapping any protected feature to require auth.
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useTheme, spacing, fontSize, borderRadius } from '@/constants/theme';

interface AuthGateProps {
    children: React.ReactNode;
    feature: string;  // Name of the feature requiring auth (for display)
    onAuthRequired?: () => void;  // Optional callback when auth is needed
}

export function AuthGate({ children, feature, onAuthRequired }: AuthGateProps) {
    const { isAuthenticated, isLoading } = useAuth();
    const { theme } = useTheme();
    const router = useRouter();

    // If loading, show nothing
    if (isLoading) {
        return (
            <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    // If authenticated, render children
    if (isAuthenticated) {
        return <>{children}</>;
    }

    // Not authenticated - show auth prompt
    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.promptCard, { backgroundColor: theme.colors.surface }]}>
                <View style={styles.iconContainer}>
                    <Ionicons name="lock-closed" size={48} color={theme.colors.primary} />
                </View>

                <Text style={[styles.title, { color: theme.colors.text }]}>
                    Sign In Required
                </Text>

                <Text style={[styles.description, { color: theme.colors.textMuted }]}>
                    {feature} requires a Whisper account. Sign in to unlock this feature and more!
                </Text>

                <View style={styles.benefits}>
                    <View style={styles.benefitRow}>
                        <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                        <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                            Unlimited AI chat
                        </Text>
                    </View>
                    <View style={styles.benefitRow}>
                        <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                        <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                            Image generation
                        </Text>
                    </View>
                    <View style={styles.benefitRow}>
                        <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                        <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                            AI character roleplay
                        </Text>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.signInButton, { backgroundColor: theme.colors.primary }]}
                    onPress={() => router.push('/auth/login')}
                >
                    <Ionicons name="log-in" size={20} color="#fff" />
                    <Text style={styles.signInText}>Sign In</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.createAccountButton, { borderColor: theme.colors.primary }]}
                    onPress={() => router.push('/auth/signup')}
                >
                    <Text style={[styles.createAccountText, { color: theme.colors.primary }]}>
                        Create Free Account
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

/**
 * Hook to check if auth is required before action
 */
export function useAuthGate() {
    const { isAuthenticated } = useAuth();
    const router = useRouter();

    const requireAuth = (feature: string, callback: () => void) => {
        if (isAuthenticated) {
            callback();
        } else {
            // Navigate to login with return info
            router.push('/auth/login');
        }
    };

    return { isAuthenticated, requireAuth };
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    promptCard: {
        width: '100%',
        maxWidth: 400,
        borderRadius: borderRadius.xl,
        padding: spacing.xl,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.lg,
    },
    title: {
        fontSize: fontSize.xl,
        fontWeight: '700',
        marginBottom: spacing.sm,
    },
    description: {
        fontSize: fontSize.md,
        textAlign: 'center',
        marginBottom: spacing.lg,
        lineHeight: 22,
    },
    benefits: {
        width: '100%',
        marginBottom: spacing.lg,
    },
    benefitRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: spacing.sm,
    },
    benefitText: {
        fontSize: fontSize.md,
    },
    signInButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        width: '100%',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        marginBottom: spacing.md,
    },
    signInText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    createAccountButton: {
        width: '100%',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 2,
        alignItems: 'center',
    },
    createAccountText: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
});

export default AuthGate;
