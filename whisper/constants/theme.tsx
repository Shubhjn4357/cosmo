/**
 * Whisper AI - Theme System
 * Modern minimal dark/light theme with amber accent and glass morphism
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Screen dimensions for responsive layout
const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const isTablet = SCREEN_WIDTH >= 768;
export const isLargeScreen = SCREEN_WIDTH >= 1024;

// Dark theme - Deep space with amber accent
export const darkTheme = {
    mode: 'dark' as const,
    colors: {
        // Primary - Amber accent
        primary: '#F59E0B',
        primaryLight: '#FBBF24',
        primaryDark: '#D97706',
        
        // Accent (alias for primary, for backward compatibility)
        accent: '#F59E0B',
        accentLight: '#FBBF24',
        
        // Secondary - Indigo for accents
        secondary: '#818cf8',
        secondaryLight: '#a5b4fc',

        // Background - Deep space
        background: '#0a0a0f',
        backgroundSecondary: '#12121a',
        
        // Surface - Glass effect
        surface: 'rgba(24, 24, 32, 0.85)',
        surfaceLight: 'rgba(36, 36, 48, 0.8)',
        surfaceBorder: 'rgba(255, 255, 255, 0.08)',
        surfaceGlass: 'rgba(24, 24, 32, 0.6)',
        
        // Text
        text: '#f8fafc',
        textSecondary: '#a1a1aa',
        textMuted: '#52525b',
        
        // Status
        success: '#34d399',
        warning: '#fbbf24',
        error: '#f87171',
        
        // Chat - Glass bubbles
        userBubble: 'rgba(245, 158, 11, 0.15)',
        userBubbleBorder: 'rgba(245, 158, 11, 0.3)',
        aiBubble: 'rgba(24, 24, 32, 0.85)',
        aiBubbleBorder: 'rgba(255, 255, 255, 0.08)',
        
        // Tab bar - Glass
        tabBar: 'rgba(10, 10, 15, 0.85)',
        tabBarBorder: 'rgba(255, 255, 255, 0.05)',

        // Sidebar
        sidebar: 'rgba(18, 18, 26, 0.95)',
        sidebarBorder: 'rgba(255, 255, 255, 0.06)',

        // Connection status
        online: '#34d399',
        offline: '#f87171',
    },
};

// Light theme - Clean with amber accent
export const lightTheme = {
    mode: 'light' as const,
    colors: {
        // Primary - Amber accent
        primary: '#D97706',
        primaryLight: '#F59E0B',
        primaryDark: '#B45309',

        // Accent (alias for primary, for backward compatibility)
        accent: '#D97706',
        accentLight: '#F59E0B',
        
        // Secondary
        secondary: '#6366f1',
        secondaryLight: '#818cf8',
        
        // Background
        background: '#fafafa',
        backgroundSecondary: '#f4f4f5',
        
        // Surface - Glass effect
        surface: 'rgba(255, 255, 255, 0.9)',
        surfaceLight: 'rgba(244, 244, 245, 0.9)',
        surfaceBorder: 'rgba(0, 0, 0, 0.08)',
        surfaceGlass: 'rgba(255, 255, 255, 0.7)',
        
        // Text
        text: '#18181b',
        textSecondary: '#52525b',
        textMuted: '#a1a1aa',
        
        // Status
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
        
        // Chat - Glass bubbles
        userBubble: 'rgba(217, 119, 6, 0.12)',
        userBubbleBorder: 'rgba(217, 119, 6, 0.25)',
        aiBubble: 'rgba(244, 244, 245, 0.9)',
        aiBubbleBorder: 'rgba(0, 0, 0, 0.06)',
        
        // Tab bar - Glass
        tabBar: 'rgba(255, 255, 255, 0.85)',
        tabBarBorder: 'rgba(0, 0, 0, 0.05)',

        // Sidebar
        sidebar: 'rgba(255, 255, 255, 0.95)',
        sidebarBorder: 'rgba(0, 0, 0, 0.06)',

        // Connection status
        online: '#22c55e',
        offline: '#ef4444',
    },
};

// Shared design tokens
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

// Theme context
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
    const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
    
    // Load saved preference
    useEffect(() => {
        AsyncStorage.getItem('themeMode').then((saved) => {
            if (saved === 'light' || saved === 'dark' || saved === 'system') {
                setThemeModeState(saved);
            }
        });
    }, []);
    
    // Save preference
    const setThemeMode = (mode: ThemeMode) => {
        setThemeModeState(mode);
        AsyncStorage.setItem('themeMode', mode);
    };
    
    // Determine actual theme
    const isDark = themeMode === 'system' 
        ? systemColorScheme === 'dark' 
        : themeMode === 'dark';
    
    const theme = isDark ? darkTheme : lightTheme;
    
    const toggleTheme = () => {
        setThemeMode(isDark ? 'light' : 'dark');
    };
    
    return (
        <ThemeContext.Provider value={{ theme, themeMode, setThemeMode, toggleTheme, isDark }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        // Fallback for outside provider
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

// Backward compatibility
export const colors = darkTheme.colors;

export default { darkTheme, lightTheme, spacing, borderRadius, fontSize };
