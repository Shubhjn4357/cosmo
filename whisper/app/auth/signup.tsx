/**
 * Whisper App - Signup Screen
 * New user registration with email/password or Native Google
 */

import React, { useState } from 'react';
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
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { useToast } from '@/components/Toast';
import {
    GoogleSignin,
    statusCodes,
    isSuccessResponse,
    isErrorWithCode,
} from '@react-native-google-signin/google-signin';

// Configure Google Sign-In (same config as login)
if (Platform.OS !== 'web') {
    GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        offlineAccess: true,
        scopes: ['profile', 'email'],
    });
}

export default function SignupScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const toast = useToast();
    const { signUp, signInWithGoogle } = useAuth();
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);

    const validateForm = () => {
        if (!email.trim() || !password.trim()) {
            return false;
        }
        if (password !== confirmPassword) {
            return false;
        }
        if (password.length < 6) {
            return false;
        }
        return true;
    };

    const handleSignup = async () => {
        if (!validateForm()) return;

        setIsLoading(true);
        try {
            const result = await signUp(email.trim(), password, displayName.trim() || undefined);
            if (result.success) {
                toast.success('Account Created!', 'Please check your email to verify.');
                router.replace('/auth/login');
            } else {
                toast.error('Signup Failed', result.error || 'Could not create account');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleSignup = async () => {
        if (Platform.OS === 'web') {
            toast.info('Not Supported', 'Google Sign-Up is not currently supported on web.');
            return;
        }
        setIsGoogleLoading(true);
        try {
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            const response = await GoogleSignin.signIn();

            if (isSuccessResponse(response)) {
                const { idToken } = response.data;
                if (idToken) {
                    const result = await signInWithGoogle(idToken);
                    if (result.success) {
                        router.replace('/(tabs)');
                    } else {
                        toast.error('Error', result.error || 'Failed to sign up with Google');
                    }
                } else {
                    router.replace('/(tabs)');
                }
            }
        } catch (error) {
            if (isErrorWithCode(error)) {
                if (error.code !== statusCodes.SIGN_IN_CANCELLED) {
                    toast.error('Error', 'Google sign-up failed');
                }
            }
        } finally {
            setIsGoogleLoading(false);
        }
    };

    const passwordsMatch = password.length === 0 || password === confirmPassword;
    const passwordLongEnough = password.length === 0 || password.length >= 6;

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
                        {/* Back Button */}
                        <TouchableOpacity
                            style={styles.backBtn}
                            onPress={() => router.back()}
                        >
                            <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                        </TouchableOpacity>

                        {/* Header */}
                        <View style={styles.header}>
                            <Text style={[styles.title, { color: theme.colors.text }]}>
                                Create Account
                            </Text>
                            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
                                Join Whisper AI and explore the power of AI
                            </Text>
                        </View>

                        {/* Signup Form */}
                        <View style={styles.form}>
                            {/* Name Input */}
                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: theme.colors.text }]}>Display Name</Text>
                                <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                                    <Ionicons name="person-outline" size={20} color={theme.colors.textMuted} />
                                    <TextInput
                                        style={[styles.input, { color: theme.colors.text }]}
                                        placeholder="Your name (optional)"
                                        placeholderTextColor={theme.colors.textMuted}
                                        value={displayName}
                                        onChangeText={setDisplayName}
                                        autoCapitalize="words"
                                    />
                                </View>
                            </View>

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
                                <View style={[
                                    styles.inputContainer,
                                    {
                                        backgroundColor: theme.colors.surface,
                                        borderColor: passwordLongEnough ? theme.colors.surfaceBorder : theme.colors.error
                                    }
                                ]}>
                                    <Ionicons name="lock-closed-outline" size={20} color={theme.colors.textMuted} />
                                    <TextInput
                                        style={[styles.input, { color: theme.colors.text }]}
                                        placeholder="Min 6 characters"
                                        placeholderTextColor={theme.colors.textMuted}
                                        value={password}
                                        onChangeText={setPassword}
                                        secureTextEntry={!showPassword}
                                    />
                                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                                        <Ionicons
                                            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                            size={20}
                                            color={theme.colors.textMuted}
                                        />
                                    </TouchableOpacity>
                                </View>
                                {!passwordLongEnough && (
                                    <Text style={[styles.errorText, { color: theme.colors.error }]}>
                                        Password must be at least 6 characters
                                    </Text>
                                )}
                            </View>

                            {/* Confirm Password Input */}
                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: theme.colors.text }]}>Confirm Password</Text>
                                <View style={[
                                    styles.inputContainer,
                                    {
                                        backgroundColor: theme.colors.surface,
                                        borderColor: passwordsMatch ? theme.colors.surfaceBorder : theme.colors.error
                                    }
                                ]}>
                                    <Ionicons name="lock-closed-outline" size={20} color={theme.colors.textMuted} />
                                    <TextInput
                                        style={[styles.input, { color: theme.colors.text }]}
                                        placeholder="Confirm password"
                                        placeholderTextColor={theme.colors.textMuted}
                                        value={confirmPassword}
                                        onChangeText={setConfirmPassword}
                                        secureTextEntry={!showPassword}
                                    />
                                </View>
                                {!passwordsMatch && (
                                    <Text style={[styles.errorText, { color: theme.colors.error }]}>
                                        Passwords don't match
                                    </Text>
                                )}
                            </View>

                            {/* Signup Button */}
                            <TouchableOpacity
                                style={[
                                    styles.signupBtn,
                                    { backgroundColor: validateForm() ? theme.colors.primary : theme.colors.surfaceLight }
                                ]}
                                onPress={handleSignup}
                                disabled={isLoading || !validateForm()}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <>
                                        <Text style={styles.signupBtnText}>Create Account</Text>
                                        <Ionicons name="arrow-forward" size={20} color="#fff" />
                                    </>
                                )}
                            </TouchableOpacity>

                            {/* Divider */}
                            <View style={styles.divider}>
                                <View style={[styles.dividerLine, { backgroundColor: theme.colors.surfaceBorder }]} />
                                <Text style={[styles.dividerText, { color: theme.colors.textMuted }]}>or</Text>
                                <View style={[styles.dividerLine, { backgroundColor: theme.colors.surfaceBorder }]} />
                            </View>

                            {/* Google Sign Up */}
                            <TouchableOpacity
                                style={[styles.googleBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}
                                onPress={handleGoogleSignup}
                                disabled={isGoogleLoading}
                            >
                                {isGoogleLoading ? (
                                    <ActivityIndicator color={theme.colors.text} />
                                ) : (
                                    <>
                                        <Ionicons name="logo-google" size={20} color="#DB4437" />
                                        <Text style={[styles.googleBtnText, { color: theme.colors.text }]}>
                                            Sign up with Google
                                        </Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>

                        {/* Login Link */}
                        <View style={styles.footer}>
                            <Text style={[styles.footerText, { color: theme.colors.textMuted }]}>
                                Already have an account?{' '}
                            </Text>
                            <TouchableOpacity onPress={() => router.replace('/auth/login')}>
                                <Text style={[styles.loginLink, { color: theme.colors.primary }]}>
                                    Sign In
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
        paddingHorizontal: spacing.xl,
        paddingBottom: spacing.xxl,
    },
    backBtn: {
        marginTop: spacing.md,
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    header: {
        marginTop: spacing.lg,
        marginBottom: spacing.xl,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        marginBottom: spacing.xs,
    },
    subtitle: {
        fontSize: fontSize.md,
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
        marginLeft: spacing.xs,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        paddingHorizontal: spacing.md,
        height: 56,
        gap: spacing.sm,
    },
    input: {
        flex: 1,
        fontSize: fontSize.md,
    },
    errorText: {
        fontSize: fontSize.xs,
        marginLeft: spacing.xs,
        marginTop: 2,
    },
    signupBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 56,
        borderRadius: borderRadius.lg,
        gap: spacing.sm,
        marginTop: spacing.md,
    },
    signupBtnText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '700',
    },
    divider: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: spacing.lg,
    },
    dividerLine: {
        flex: 1,
        height: 1,
    },
    dividerText: {
        marginHorizontal: spacing.md,
        fontSize: fontSize.sm,
    },
    googleBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 56,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        gap: spacing.sm,
    },
    googleBtnText: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: spacing.xl,
    },
    footerText: {
        fontSize: fontSize.md,
    },
    loginLink: {
        fontSize: fontSize.md,
        fontWeight: '700',
    },
});
