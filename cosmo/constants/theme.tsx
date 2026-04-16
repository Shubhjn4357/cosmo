/**
 * Cosmo AI — Unified Theme System 2026
 * Cosmic glassmorphism with deep space dark + clean light mode
 * Replaces amber with cosmic purple/cyan palette
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const isTablet = SCREEN_WIDTH >= 768;
export const isLargeScreen = SCREEN_WIDTH >= 1024;

// ─── DARK THEME — Deep cosmic space ─────────────────────────────────────────
export const darkTheme = {
    mode: 'dark' as const,
    colors: {
        primary: '#8b5cf6', // Electric Purple
        primaryLight: '#a78bfa',
        primaryDark: '#7c3aed',
        accent: '#06b6d4', // Cyan Nebula
        accentLight: '#22d3ee',
        secondary: '#ec4899', // Pink Pulsar
        secondaryLight: '#f472b6',
        background: '#05050f', // Deep Space
        backgroundSecondary: '#0d0d1a',
        surface: 'rgba(15, 15, 30, 0.85)',
        surfaceLight: 'rgba(30, 30, 50, 0.75)',
        surfaceBorder: 'rgba(139, 92, 246, 0.15)',
        surfaceGlass: 'rgba(15, 15, 30, 0.60)',
        text: '#f0f0ff',
        textSecondary: '#a0a0cc',
        textMuted: '#555580',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#f43f5e',
        online: '#10b981',
        offline: '#f43f5e',
        sidebar: 'rgba(15, 15, 30, 0.98)',
        sidebarBorder: 'rgba(139, 92, 246, 0.10)',
        userBubble: 'rgba(139, 92, 246, 0.15)',
        userBubbleBorder: 'rgba(139, 92, 246, 0.25)',
        aiBubble: 'rgba(30, 30, 50, 0.85)',
        aiBubbleBorder: 'rgba(139, 92, 246, 0.10)',
        tabBar: 'rgba(15, 15, 30, 0.95)',
        tabBarBorder: 'rgba(139, 92, 246, 0.08)',
        gradientStart: '#8b5cf6',
        gradientMid: '#3b82f6',
        gradientEnd: '#ec4899',
    },
    glass: {
        intensity: 0.85,
        blur: 40,
        border: 'rgba(255, 255, 255, 0.12)',
    }
};

// ─── LIGHT THEME — Clean cosmic light ────────────────────────────────────────
export const lightTheme = {
    mode: 'light' as const,
    colors: {
        primary: '#7c3aed',
        primaryLight: '#8b5cf6',
        primaryDark: '#6d28d9',

        accent: '#0891b2',
        accentLight: '#06b6d4',

        secondary: '#db2777',
        secondaryLight: '#ec4899',

        background: '#f8f7ff',
        backgroundSecondary: '#f0eeff',

        surface: 'rgba(255, 255, 255, 0.92)',
        surfaceLight: 'rgba(244, 242, 255, 0.92)',
        surfaceBorder: 'rgba(124, 58, 237, 0.12)',
        surfaceGlass: 'rgba(255, 255, 255, 0.70)',

        text: '#1a1040',
        textSecondary: '#4a4070',
        textMuted: '#9090c0',

        success: '#059669',
        warning: '#d97706',
        error: '#dc2626',

        userBubble: 'rgba(124, 58, 237, 0.10)',
        userBubbleBorder: 'rgba(124, 58, 237, 0.22)',
        aiBubble: 'rgba(255, 255, 255, 0.92)',
        aiBubbleBorder: 'rgba(124, 58, 237, 0.10)',

        tabBar: 'rgba(248, 247, 255, 0.92)',
        tabBarBorder: 'rgba(124, 58, 237, 0.08)',

        sidebar: 'rgba(255, 255, 255, 0.97)',
        sidebarBorder: 'rgba(124, 58, 237, 0.08)',

        online: '#059669',
        offline: '#dc2626',

        gradientStart: '#7c3aed',
        gradientMid: '#0891b2',
        gradientEnd: '#db2777',
    },
};

// ─── Design Tokens ────────────────────────────────────────────────────────────
export const spacing = {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
};

export const borderRadius = {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    full: 9999,
};

export const fontSize = {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 24,
    xxl: 32,
};

// ─── Shadow presets ───────────────────────────────────────────────────────────
export const shadows = {
    glow: {
        shadowColor: '#8b5cf6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
    },
    soft: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 4,
    },
};

// ─── Context ──────────────────────────────────────────────────────────────────
type Theme = typeof darkTheme | typeof lightTheme;
type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
    theme: Theme;
    themeMode: ThemeMode;
    setThemeMode: (mode: ThemeMode) => void;
    toggleTheme: () => void;
    isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const systemColorScheme = useColorScheme();
    const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');

    useEffect(() => {
        AsyncStorage.getItem('cosmo_themeMode').then((saved) => {
            if (saved === 'light' || saved === 'dark' || saved === 'system') {
                setThemeModeState(saved);
            }
        });
    }, []);

    const setThemeMode = (mode: ThemeMode) => {
        setThemeModeState(mode);
        AsyncStorage.setItem('cosmo_themeMode', mode);
    };

    const isDark = themeMode === 'system'
        ? systemColorScheme === 'dark'
        : themeMode === 'dark';

    const theme = isDark ? darkTheme : lightTheme;

    const toggleTheme = () => setThemeMode(isDark ? 'light' : 'dark');

    return (
        <ThemeContext.Provider value={{ theme, themeMode, setThemeMode, toggleTheme, isDark }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        return {
            theme: darkTheme,
            themeMode: 'dark' as ThemeMode,
            setThemeMode: () => {},
            toggleTheme: () => {},
            isDark: true,
        };
    }
    return context;
}

export const colors = darkTheme.colors;
export default { darkTheme, lightTheme, spacing, borderRadius, fontSize, shadows };
