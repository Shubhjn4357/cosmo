/**
 * GlassButton - Glassmorphic button with bouncy animations
 * Material 3 design with ripple effect
 */

import React, { useEffect } from 'react';
import { Text, StyleSheet, Pressable, ViewStyle, TextStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useM3Colors, createGlassStyle, M3_RADIUS, M3_SPACING } from '@/constants/material3';
import { SPRING_CONFIGS, ANIMATIONS } from '@/constants/animations';
import { useTheme } from '@/constants/theme';

interface GlassButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'light' | 'medium' | 'heavy' | 'accent';
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function GlassButton({
  title,
  onPress,
  variant = 'accent',
  disabled = false,
  style,
  textStyle,
  icon,
}: GlassButtonProps) {
  const { isDark } = useTheme();
  const m3Colors = useM3Colors();
  const glassStyle = createGlassStyle(variant, isDark);
  
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const handlePressIn = () => {
    scale.value = withSpring(ANIMATIONS.tapScale.to, SPRING_CONFIGS.snappy);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, SPRING_CONFIGS.bouncy);
  };

  useEffect(() => {
    opacity.value = disabled ? 0.5 : 1;
  }, [disabled]);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[animatedStyle]}
    >
      <BlurView
        intensity={15}
        tint={isDark ? 'dark' : 'light'}
        style={[styles.button, glassStyle, style]}
      >
        {icon && <>{icon}</>}
        <Text style={[styles.text, { color: m3Colors.onPrimary }, textStyle]}>
          {title}
        </Text>
      </BlurView>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: M3_SPACING.sm,
    paddingHorizontal: M3_SPACING.lg,
    paddingVertical: M3_SPACING.md,
    borderRadius: M3_RADIUS.lg,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default GlassButton;
