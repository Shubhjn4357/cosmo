/**
 * GlassCard - Glassmorphic card component
 * Material 3 design with frosted glass effect
 */

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useM3Colors, createGlassStyle, M3_RADIUS } from '@/constants/material3';
import { useTheme } from '@/constants/theme';

interface GlassCardProps {
  children: React.ReactNode;
  variant?: 'light' | 'medium' | 'heavy' | 'accent';
  style?: ViewStyle;
  blurIntensity?: number;
  elevated?: boolean;
}

export function GlassCard({ 
  children, 
  variant = 'medium',
  style,
  blurIntensity = 20,
  elevated = true,
}: GlassCardProps) {
  const { isDark } = useTheme();
  const m3Colors = useM3Colors();
  const glassStyle = createGlassStyle(variant, isDark);

  return (
    <View style={[styles.container, elevated && glassStyle, style]}>
      <BlurView
        intensity={blurIntensity}
        tint={isDark ? 'dark' : 'light'}
        style={styles.blur}
      >
        {children}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: M3_RADIUS.lg,
    overflow: 'hidden',
  },
  blur: {
    flex: 1,
  },
});

export default GlassCard;
