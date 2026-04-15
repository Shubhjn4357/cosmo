import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { ThemeProvider, useTheme } from '@/constants/theme';
import {
    AIRuntimeProvider,
    AppPreferencesProvider,
    AuthProvider,
    PersonalityProvider,
    useAuth,
    useSimpleKeepalive,
} from '@/hooks';
import { ToastProvider } from '@/components/Toast';
import { DialogProvider } from '@/components/Dialog';

// Navigation guard component
function NavigationGuard({ children }: { children: React.ReactNode }) {
    const { isLoading, isAuthenticated, hasCompletedOnboarding, hasGivenConsent } = useAuth();
    const segments = useSegments();
    const router = useRouter();
    const { theme } = useTheme();

    useEffect(() => {
        if (isLoading) return;

        const inAuthGroup = segments[0] === 'auth';
        const inOnboarding = segments[0] === 'onboarding';
        const inConsent = segments[0] === 'consent';

        // Step 1: Onboarding check
        if (!hasCompletedOnboarding && !inOnboarding) {
            router.replace('/onboarding');
            return;
        }

        // Step 2: Consent check
        if (hasCompletedOnboarding && !hasGivenConsent && !inConsent && !inOnboarding) {
            router.replace('/consent');
            return;
        }

        // Step 3: Auth redirection
        if (isAuthenticated && (inAuthGroup || inConsent || inOnboarding)) {
            router.replace('/(tabs)');
            return;
        }

        // Step 4: Protected tabs
        const protectedTabs = ['admin', 'profile'];
        const currentTab = segments[1] ?? '';
        if (segments[0] === '(tabs)' && protectedTabs.includes(currentTab)) {
            if (!isAuthenticated) {
                router.replace('/auth/login');
                return;
            }
        }

        // Step 5: Default redirect to tabs
        if (hasCompletedOnboarding && hasGivenConsent && !isAuthenticated && !inAuthGroup && segments[0] !== '(tabs)') {
            router.replace('/(tabs)');
            return;
        }
    }, [isLoading, isAuthenticated, hasCompletedOnboarding, hasGivenConsent, segments]);

    if (isLoading) {
        return (
            <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    return <>{children}</>;
}

function RootLayoutContent() {
    const { theme, isDark } = useTheme();
    
    // ✅ Auto-ping server every 30 minutes to prevent HuggingFace from sleeping
    useSimpleKeepalive(30);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <LinearGradient
                colors={isDark 
                    ? ['#05050f', '#1a1a2e', '#05050f']
                    : ['#f8f7ff', '#f0eeff', '#e0ddff']
                }
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
            />
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <NavigationGuard>
                <Stack
                    screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: 'transparent' },
                        animation: 'fade_from_bottom',
                        animationDuration: 400,
                    }}
                >
                    <Stack.Screen name="onboarding" />
                    <Stack.Screen name="consent" />
                    <Stack.Screen name="auth" />
                    <Stack.Screen name="(tabs)" />
                </Stack>
            </NavigationGuard>
        </View>
    );
}

export default function RootLayout() {
    return (
        <SafeAreaProvider>
            <ThemeProvider>
                <AuthProvider>
                    <AIRuntimeProvider>
                        <AppPreferencesProvider>
                            <PersonalityProvider>
                                <DialogProvider>
                                    <ToastProvider>
                                        <RootLayoutContent />
                                    </ToastProvider>
                                </DialogProvider>
                            </PersonalityProvider>
                        </AppPreferencesProvider>
                    </AIRuntimeProvider>
                </AuthProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
