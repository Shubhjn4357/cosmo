/**
 * Cosmo App - Login Screen
 * User authentication with email/password or Native Google Sign-In
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { cosmoAPI } from '@/services/api';
import { ensureGoogleSigninConfigured, performNativeGoogleSignin } from '@/services/googleSignin';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { useToast } from '@/components/Toast';

export default function LoginScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const toast = useToast();
    const { signIn, signInWithGoogle } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [isGoogleAvailable, setIsGoogleAvailable] = useState(false);

    useEffect(() => {
        let mounted = true;

        const prepareGoogleSignin = async () => {
            if (Platform.OS === 'web') {
                return;
            }

            const available = await ensureGoogleSigninConfigured();
            if (mounted) {
                setIsGoogleAvailable(available);
            }
        };

        void prepareGoogleSignin();

        return () => {
            mounted = false;
        };
    }, []);

    const handleLogin = async () => {
        if (!email.trim() || !password.trim()) {
            return;
        }

        setIsLoading(true);
        try {
            const result = await signIn(email.trim(), password);
            if (result.success) {
                router.replace('/(tabs)');
            } else {
                toast.error('Login Failed', result.error || 'Invalid credentials');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        if (Platform.OS === 'web') {
            toast.info('Not Supported', 'Google Sign-In is not currently supported on web.');
            return;
        }
        setIsGoogleLoading(true);
        try {
            const result = await performNativeGoogleSignin();

            if (!result.success) {
                switch (result.reason) {
                    case 'sign_in_cancelled':
                        return;
                    case 'in_progress':
                        toast.info('Please wait', 'Sign-in is in progress');
                        return;
                    case 'play_services_unavailable':
                        toast.error('Error', 'Google Play Services not available');
                        return;
                    case 'module_unavailable':
                    case 'configure_failed':
                    case 'missing_client_id':
                        toast.error(
                            'Unavailable',
                            'Google Sign-In is unavailable in this build. Use email sign-in instead.'
                        );
                        setIsGoogleAvailable(false);
                        return;
                    default:
                        console.error('Google sign-in error:', result.error);
                        toast.error('Error', 'Google sign-in failed');
                        return;
                }
            }

            if (result.idToken) {
                const authResult = await signInWithGoogle(result.idToken);
                if (authResult.success) {
                    router.replace('/(tabs)');
                } else {
                    toast.error('Error', authResult.error || 'Failed to sign in with Google');
                }
                return;
            }

            toast.success(
                'Success',
                `Welcome, ${result.user?.name || result.user?.email || 'there'}!`
            );
            router.replace('/(tabs)');
        } finally {
            setIsGoogleLoading(false);
        }
    };

    return (
        <LinearGradient
            colors={[theme.colors.background, theme.colors.surface]}
            style={styles.container}
        >
            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.keyboardView}
                >
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Logo & Header */}
                        <View style={styles.header}>
                            <View style={[styles.logoContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                                <Ionicons name="sparkles" size={48} color={theme.colors.primary} />
                            </View>
                            <Text style={[styles.title, { color: theme.colors.text }]}>
                                Welcome Back
                            </Text>
                            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
                                Sign in to continue with Cosmo AI
                            </Text>
                        </View>

                        {/* Login Form */}
                        <View style={styles.form}>
                            {/* Email Input */}
                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: theme.colors.text }]}>Email</Text>
                                <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                                    <Ionicons name="mail-outline" size={20} color={theme.colors.textMuted} />
                                    <TextInput
                                        style={[styles.input, { color: theme.colors.text }]}
                                        placeholder="Enter your email"
                                        placeholderTextColor={theme.colors.textMuted}
                                        value={email}
                                        onChangeText={setEmail}
                                        keyboardType="email-address"
                                        autoCapitalize="none"
                                        autoComplete="email"
                                    />
                                </View>
                            </View>

                            {/* Password Input */}
                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: theme.colors.text }]}>Password</Text>
                                <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                                    <Ionicons name="lock-closed-outline" size={20} color={theme.colors.textMuted} />
                                    <TextInput
                                        style={[styles.input, { color: theme.colors.text }]}
                                        placeholder="Enter your password"
                                        placeholderTextColor={theme.colors.textMuted}
                                        value={password}
                                        onChangeText={setPassword}
                                        secureTextEntry={!showPassword}
                                        autoComplete="password"
                                    />
                                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                                        <Ionicons
                                            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                            size={20}
                                            color={theme.colors.textMuted}
                                        />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Forgot Password */}
                            <TouchableOpacity
                                style={styles.forgotPassword}
                                onPress={() => router.push('/auth/forgot-password')}
                            >
                                <Text style={[styles.forgotText, { color: theme.colors.primary }]}>
                                    Forgot Password?
                                </Text>
                            </TouchableOpacity>

                            {/* Login Button */}
                            <TouchableOpacity
                                style={[
                                    styles.loginButton,
                                    { backgroundColor: theme.colors.primary },
                                    (!email.trim() || !password.trim()) && styles.buttonDisabled,
                                ]}
                                onPress={handleLogin}
                                disabled={isLoading || !email.trim() || !password.trim()}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.loginButtonText}>Sign In</Text>
                                )}
                            </TouchableOpacity>

                            {/* Divider */}
                            <View style={styles.divider}>
                                <View style={[styles.dividerLine, { backgroundColor: theme.colors.surfaceBorder }]} />
                                <Text style={[styles.dividerText, { color: theme.colors.textMuted }]}>or</Text>
                                <View style={[styles.dividerLine, { backgroundColor: theme.colors.surfaceBorder }]} />
                            </View>

                            {/* Google Sign-In Button - Native */}
                            <TouchableOpacity
                                style={[styles.googleButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}
                                onPress={handleGoogleLogin}
                                disabled={isGoogleLoading || !isGoogleAvailable}
                            >
                                {isGoogleLoading ? (
                                    <ActivityIndicator color={theme.colors.text} />
                                ) : (
                                    <>
                                        <Ionicons name="logo-google" size={20} color="#DB4437" />
                                        <Text style={[styles.googleButtonText, { color: theme.colors.text }]}>
                                            {isGoogleAvailable ? 'Continue with Google' : 'Google Sign-In Unavailable'}
                                        </Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>

                        {/* Sign Up Link */}
                        <View style={styles.signUpContainer}>
                            <Text style={[styles.signUpText, { color: theme.colors.textMuted }]}>
                                Don't have an account?{' '}
                            </Text>
                            <TouchableOpacity onPress={() => router.push('/auth/signup')}>
                                <Text style={[styles.signUpLink, { color: theme.colors.primary }]}>
                                    Sign Up
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    safeArea: {
        flex: 1,
    },
    keyboardView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xl,
    },
    header: {
        alignItems: 'center',
        marginTop: spacing.xxl,
        marginBottom: spacing.xl,
    },
    logoContainer: {
        width: 80,
        height: 80,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.lg,
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
        marginBottom: spacing.xs,
    },
    subtitle: {
        fontSize: fontSize.md,
        textAlign: 'center',
    },
    form: {
        gap: spacing.md,
    },
    inputGroup: {
        gap: spacing.xs,
    },
    label: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        gap: spacing.sm,
    },
    input: {
        flex: 1,
        fontSize: fontSize.md,
    },
    forgotPassword: {
        alignSelf: 'flex-end',
    },
    forgotText: {
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    loginButton: {
        paddingVertical: spacing.md + 2,
        borderRadius: borderRadius.lg,
        alignItems: 'center',
        marginTop: spacing.sm,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    loginButtonText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    divider: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: spacing.md,
    },
    dividerLine: {
        flex: 1,
        height: 1,
    },
    dividerText: {
        marginHorizontal: spacing.md,
        fontSize: fontSize.sm,
    },
    googleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        gap: spacing.sm,
    },
    googleButtonText: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    signUpContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: spacing.xl,
    },
    signUpText: {
        fontSize: fontSize.md,
    },
    signUpLink: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
});
