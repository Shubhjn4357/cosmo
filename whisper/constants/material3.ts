/**
 * Material 3 Design System with Glassmorphism
 * Auto-extracts system theme colors and provides glass utilities
 */

import { Platform } from 'react-native';
import { useColorScheme } from 'react-native';

// Material 3 Color Tokens
export interface M3ColorScheme {
  // Primary
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  
  // Secondary
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  
  // Tertiary
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  
  // Error
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  
  // Surface
  surface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceVariant: string;
  onSurface: string;
  onSurfaceVariant: string;
  
  // Container levels
  surfaceContainer: string;
  surfaceContainerLow: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  
  // Outline
  outline: string;
  outlineVariant: string;
  
  // Inverse
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  
  // Glass overlays
  glassLight: string;
  glassMedium: string;
  glassHeavy: string;
  glassAccent: string;
}

// Light Mode Material 3 Colors
export const M3Light: M3ColorScheme = {
  primary: '#6750A4',
  onPrimary: '#FFFFFF',
  primaryContainer: '#EADDFF',
  onPrimaryContainer: '#21005D',
  
  secondary: '#625B71',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E8DEF8',
  onSecondaryContainer: '#1D192B',
  
  tertiary: '#7D5260',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFD8E4',
  onTertiaryContainer: '#31111D',
  
  error: '#B3261E',
  onError: '#FFFFFF',
  errorContainer: '#F9DEDC',
  onErrorContainer: '#410E0B',
  
  surface: '#FEF7FF',
  surfaceDim: '#DED8E1',
  surfaceBright: '#FEF7FF',
  surfaceVariant: '#E7E0EC',
  onSurface: '#1C1B1F',
  onSurfaceVariant: '#49454F',
  
  surfaceContainer: '#F3EDF7',
  surfaceContainerLow: '#F7F2FA',
  surfaceContainerHigh: '#ECE6F0',
  surfaceContainerHighest: '#E6E0E9',
  
  outline: '#79747E',
  outlineVariant: '#CAC4D0',
  
  inverseSurface: '#313033',
  inverseOnSurface: '#F4EFF4',
  inversePrimary: '#D0BCFF',
  
  // Glass overlays
  glassLight: 'rgba(255, 255, 255, 0.5)',
  glassMedium: 'rgba(255, 255, 255, 0.7)',
  glassHeavy: 'rgba(255, 255, 255, 0.85)',
  glassAccent: 'rgba(103, 80, 164, 0.12)',
};

// Dark Mode Material 3 Colors
export const M3Dark: M3ColorScheme = {
  primary: '#D0BCFF',
  onPrimary: '#381E72',
  primaryContainer: '#4F378B',
  onPrimaryContainer: '#EADDFF',
  
  secondary: '#CCC2DC',
  onSecondary: '#332D41',
  secondaryContainer: '#4A4458',
  onSecondaryContainer: '#E8DEF8',
  
  tertiary: '#EFB8C8',
  onTertiary: '#492532',
  tertiaryContainer: '#633B48',
  onTertiaryContainer: '#FFD8E4',
  
  error: '#F2B8B5',
  onError: '#601410',
  errorContainer: '#8C1D18',
  onErrorContainer: '#F9DEDC',
  
  surface: '#141218',
  surfaceDim: '#141218',
  surfaceBright: '#3B383E',
  surfaceVariant: '#49454F',
  onSurface: '#E6E1E5',
  onSurfaceVariant: '#CAC4D0',
  
  surfaceContainer: '#211F26',
  surfaceContainerLow: '#1D1B20',
  surfaceContainerHigh: '#2B2930',
  surfaceContainerHighest: '#36343B',
  
  outline: '#938F99',
  outlineVariant: '#49454F',
  
  inverseSurface: '#E6E1E5',
  inverseOnSurface: '#313033',
  inversePrimary: '#6750A4',
  
  // Glass overlays
  glassLight: 'rgba(255, 255, 255, 0.05)',
  glassMedium: 'rgba(255, 255, 255, 0.08)',
  glassHeavy: 'rgba(255, 255, 255, 0.12)',
  glassAccent: 'rgba(208, 188, 255, 0.15)',
};

/**
 * Get Material 3 color scheme based on system theme
 */
export function useM3Colors(): M3ColorScheme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? M3Dark : M3Light;
}

/**
 * Glassmorphism style generator
 */
export interface GlassStyle {
  backgroundColor: string;
  borderWidth?: number;
  borderColor?: string;
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
}

export function createGlassStyle(
  variant: 'light' | 'medium' | 'heavy' | 'accent' = 'medium',
  isDark: boolean = false
): GlassStyle {
  const colors = isDark ? M3Dark : M3Light;
  
  const backgrounds = {
    light: colors.glassLight,
    medium: colors.glassMedium,
    heavy: colors.glassHeavy,
    accent: colors.glassAccent,
  };
  
  return {
    backgroundColor: backgrounds[variant],
    borderWidth: 1,
    borderColor: isDark 
      ? 'rgba(255, 255, 255, 0.12)' 
      : 'rgba(255, 255, 255, 0.5)',
    shadowColor: isDark ? '#000000' : '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.3 : 0.1,
    shadowRadius: 16,
    elevation: 4,
  };
}

/**
 * Elevation levels for depth
 */
export const ELEVATIONS = {
  none: 0,
  low: 1,
  medium: 3,
  high: 6,
  highest: 12,
};

/**
 * Border radius tokens
 */
export const M3_RADIUS = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 9999,
};

/**
 * Spacing tokens
 */
export const M3_SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};
