/**
 * LoadingDots - Bouncing dots loading animation
 * Material 3 vibrant loading indicator
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { useM3Colors } from '@/constants/material3';
import { M3_DURATIONS } from '@/constants/animations';

interface LoadingDotsProps {
  color?: string;
  size?: number;
}

export function LoadingDots({ color, size = 8 }: LoadingDotsProps) {
  const m3Colors = useM3Colors();
  const dotColor = color || m3Colors.primary;

  return (
    <View style={styles.container}>
      <BouncingDot delay={0} color={dotColor} size={size} />
      <BouncingDot delay={150} color={dotColor} size={size} />
      <BouncingDot delay={300} color={dotColor} size={size} />
    </View>
  );
}

function BouncingDot({ delay, color, size }: { delay: number; color: string; size: number }) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-size * 1.5, { duration: M3_DURATIONS.medium2 }),
          withTiming(0, { duration: M3_DURATIONS.medium2 })
        ),
        -1,
        false
      )
    );
  }, [delay, size]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: color,
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {},
});

export default LoadingDots;
