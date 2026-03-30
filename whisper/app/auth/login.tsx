/**
 * Whisper App - Login Screen
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
import { whisperAPI } from '@/services/api';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { useToast } from '@/components/Toast';
import {
    GoogleSignin,
    statusCodes,
    isSuccessResponse,
    isErrorWithCode,
} from '@react-native-google-signin/google-signin';

// Configure Google Sign-In on module load
if (Platform.OS !== 'web') {
    GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        offlineAccess: true,
        scopes: ['profile', 'email'],
    });
}

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
            // Check if Google Play Services are available (Android)
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
            
            // Perform native sign-in
            const response = await GoogleSignin.signIn();
            
            if (isSuccessResponse(response)) {
                // Get the ID token for backend verification
                const { idToken } = response.data;
                
                if (idToken) {
                    // Send to our backend via Supabase
                    const result = await signInWithGoogle(idToken);
                    if (result.success) {
                        router.replace('/(tabs)');
                    } else {
                        toast.error('Error', result.error || 'Failed to sign in with Google');
                    }
                } else {
                    // If no idToken, use user info directly
                    const userInfo = response.data.user;
                    // console.log('Google user info:', userInfo);
                    toast.success('Success', `Welcome, ${userInfo.name}!`);
                    router.replace('/(tabs)');
                }
            }
        } catch (error) {
            if (isErrorWithCode(error)) {
                switch (error.code) {
                    case statusCodes.SIGN_IN_CANCELLED:
                        // User cancelled the sign-in flow
                        console.log('Sign-in cancelled');
                        break;
                    case statusCodes.IN_PROGRESS:
                        // Sign-in already in progress
                        toast.info('Please wait', 'Sign-in is in progress');
                        break;
                    case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
                        toast.error('Error', 'Google Play Services not available');
                        break;
                    default:
                        console.error('Google sign-in error:', error);
                        toast.error('Error', 'Google sign-in failed');
                }
            } else {
                console.error('Unknown error:', error);
                toast.error('Error', 'An unexpected error occurred');
            }
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
                                Sign in to continue with Whisper AI
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
                                disabled={isGoogleLoading}
                            >
                                {isGoogleLoading ? (
                                    <ActivityIndicator color={theme.colors.text} />
                                ) : (
                                    <>
                                        <Ionicons name="logo-google" size={20} color="#DB4437" />
                                        <Text style={[styles.googleButtonText, { color: theme.colors.text }]}>
                                            Continue with Google
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
