/**
 * Whisper App - Auth Layout
 * Handles auth routes and callback
 */

import { Stack } from 'expo-router';
import { useTheme } from '@/constants/theme';

export default function AuthLayout() {
    const { theme } = useTheme();

    return (
        <Stack
            screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.background },
                animation: 'slide_from_right',
            }}
        >
            <Stack.Screen name="login" />
            <Stack.Screen name="signup" />
            <Stack.Screen name="forgot-password" />
        </Stack>
    );
}
