import { Platform } from 'react-native';

/**
 * Cosmo AI - Design System Tokens
 * Implementing a premium, glassmorphic theme system with high-contrast variants.
 */

export const COLORS = {
  // Deep space palette
  void: '#000000',
  space: '#05050f',
  nebula: '#1a1a2e',
  
  // Vibrant accents
  starlight: '#ffffff',
  nova: '#8b5cf6', // Electric Purple
  quas: '#3b82f6', // Deep Blue
  pulse: '#f43f5e', // Warning / Action Red
  
  // Translucent overlays
  glass: 'rgba(255, 255, 255, 0.08)',
  glassDark: 'rgba(0, 0, 0, 0.4)',
  glassBorder: 'rgba(255, 255, 255, 0.15)',
};

export const BLUR_INTENSITY = {
  none: 0,
  light: 30,
  heavy: 70,
  ultra: 100,
};

export const GLASS_STYLE = {
  backgroundColor: COLORS.glass,
  borderWidth: 1,
  borderColor: COLORS.glassBorder,
  borderRadius: 20,
  ...Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
    },
    android: {
      elevation: 10,
    },
  }),
};

export const SHADOWS = {
  soft: {
    shadowColor: COLORS.void,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  glow: {
    shadowColor: COLORS.nova,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 15,
  },
};

export const TYPOGRAPHY = {
  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.starlight,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 22,
    fontWeight: '600',
    color: COLORS.starlight,
  },
  body: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 24,
  },
  meta: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
};

export default {
  COLORS,
  BLUR_INTENSITY,
  GLASS_STYLE,
  SHADOWS,
  TYPOGRAPHY,
};
