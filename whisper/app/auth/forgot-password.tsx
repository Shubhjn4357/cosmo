/**
 * Forgot Password Screen
 * Password reset flow using Supabase
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { authAPI } from '@/services/profileAPI';
import { useToast } from '@/components/Toast';

export default function ForgotPasswordScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const toast = useToast();

    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [emailSent, setEmailSent] = useState(false);

    const handleResetPassword = async () => {
        if (!email.trim()) {
            toast.error('Email Required', 'Please enter your email address');
            return;
        }

        setIsLoading(true);
        try {
            const result = await authAPI.resetPassword(email);
            if (!result.error) {
                setEmailSent(true);
                toast.success('Email Sent', 'Check your inbox for reset instructions');
            } else {
                toast.error('Error', result.error);
            }
        } catch (error: any) {
            toast.error('Error', error.message || 'Failed to send reset email');
        } finally {
            setIsLoading(false);
        }
    };

    if (emailSent) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <View style={styles.content}>
                    <View style={[styles.successIcon, { backgroundColor: theme.colors.success + '20' }]}>
                        <Ionicons name="checkmark-circle" size={64} color={theme.colors.success} />
                    </View>

                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        Email Sent!
                    </Text>

                    <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
                        We've sent password reset instructions to{'\n'}
                        <Text style={{ fontWeight: '600' }}>{email}</Text>
                    </Text>

                    <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
                        Check your spam folder if you don't see it
                    </Text>

                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: theme.colors.primary }]}
                        onPress={() => router.back()}
                    >
                        <Text style={styles.buttonText}>Back to Login</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                </View>

                <View style={styles.content}>
                    <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                        <Ionicons name="lock-closed" size={48} color={theme.colors.primary} />
                    </View>

                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        Forgot Password?
                    </Text>

                    <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
                        Enter your email address and we'll send you instructions to reset your password
                    </Text>

                    <TextInput
                        style={[styles.input, {
                            backgroundColor: theme.colors.surface,
                            color: theme.colors.text,
                            borderColor: theme.colors.surfaceBorder
                        }]}
                        placeholder="Email address"
                        placeholderTextColor={theme.colors.textMuted}
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        editable={!isLoading}
                    />

                    <TouchableOpacity
                        style={[
                            styles.button,
                            { backgroundColor: theme.colors.primary },
                            isLoading && { opacity: 0.6 }
                        ]}
                        onPress={handleResetPassword}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.buttonText}>Send Reset Link</Text>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.backToLogin}
                        onPress={() => router.back()}
                    >
                        <Text style={[styles.backToLoginText, { color: theme.colors.textSecondary }]}>
                            Remember your password?{' '}
                            <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>
                                Sign In
                            </Text>
                        </Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    keyboardView: {
        flex: 1,
    },
    header: {
        padding: spacing.md,
    },
    backButton: {
        width: 40,
        height: 40,
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        padding: spacing.xl,
        justifyContent: 'center',
    },
    iconContainer: {
        width: 96,
        height: 96,
        borderRadius: 48,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        marginBottom: spacing.xl,
    },
    successIcon: {
        width: 96,
        height: 96,
        borderRadius: 48,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        marginBottom: spacing.xl,
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: spacing.md,
    },
    description: {
        fontSize: fontSize.md,
        textAlign: 'center',
        marginBottom: spacing.xl,
        lineHeight: 24,
    },
    hint: {
        fontSize: fontSize.sm,
        textAlign: 'center',
        marginBottom: spacing.xl,
    },
    input: {
        height: 52,
        borderRadius: borderRadius.lg,
        paddingHorizontal: spacing.md,
        fontSize: fontSize.md,
        marginBottom: spacing.lg,
        borderWidth: 1,
    },
    button: {
        height: 52,
        borderRadius: borderRadius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.lg,
    },
    buttonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    backToLogin: {
        padding: spacing.md,
        alignItems: 'center',
    },
    backToLoginText: {
        fontSize: fontSize.md,
    },
});
