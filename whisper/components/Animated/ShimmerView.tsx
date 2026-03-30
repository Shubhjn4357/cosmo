/**
 * ShimmerView - Shimmer loading effect
 * Material 3 skeleton loader
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle, type DimensionValue } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useM3Colors } from '@/constants/material3';
import { ANIMATIONS } from '@/constants/animations';

interface ShimmerViewProps {
  width?: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function ShimmerView({ 
  width = '100%', 
  height, 
  borderRadius = 8,
  style 
}: ShimmerViewProps) {
  const m3Colors = useM3Colors();
  const shimmerTranslate = useSharedValue(ANIMATIONS.shimmer.from);

  useEffect(() => {
    shimmerTranslate.value = withRepeat(
      withTiming(ANIMATIONS.shimmer.to, { 
        duration: ANIMATIONS.shimmer.duration 
      }),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const numericWidth = typeof width === 'number' ? width : 320;
    const translateX = interpolate(
      shimmerTranslate.value,
      [ANIMATIONS.shimmer.from, ANIMATIONS.shimmer.to],
      [-numericWidth, numericWidth],
      Extrapolate.CLAMP
    );

    return {
      transform: [{ translateX }],
    };
  });

  return (
    <View
      style={[
        styles.container,
        {
          width,
          height,
          borderRadius,
          backgroundColor: m3Colors.surfaceContainer,
        },
        style,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
        <LinearGradient
          colors={[
            'transparent',
            m3Colors.surfaceContainerHigh,
            'transparent',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});

export default ShimmerView;
