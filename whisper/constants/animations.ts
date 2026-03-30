/**
 * Animation presets and utilities
 * Bouncy, vibrant animations throughout the app
 */

import { Easing, WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

/**
 * Spring animation configs
 */
export const SPRING_CONFIGS = {
  // Gentle bounce
  gentle: {
    damping: 20,
    stiffness: 120,
    mass: 1,
  } as WithSpringConfig,
  
  // Default bouncy
  bouncy: {
    damping: 15,
    stiffness: 150,
    mass: 1,
  } as WithSpringConfig,
  
  // Very bouncy
  veryBouncy: {
    damping: 10,
    stiffness: 180,
    mass: 0.8,
  } as WithSpringConfig,
  
  // Smooth (no bounce)
  smooth: {
    damping: 30,
    stiffness: 200,
    mass: 1,
  } as WithSpringConfig,
  
  // Snappy
  snappy: {
    damping: 12,
    stiffness: 250,
    mass: 0.6,
  } as WithSpringConfig,
};

/**
 * Timing animation configs
 */
export const TIMING_CONFIGS = {
  // Quick
  quick: {
    duration: 150,
    easing: Easing.out(Easing.ease),
  } as WithTimingConfig,
  
  // Normal
  normal: {
    duration: 250,
    easing: Easing.out(Easing.cubic),
  } as WithTimingConfig,
  
  // Slow
  slow: {
    duration: 400,
    easing: Easing.out(Easing.cubic),
  } as WithTimingConfig,
  
  // Very slow
  verySlow: {
    duration: 600,
    easing: Easing.inOut(Easing.cubic),
  } as WithTimingConfig,
  
  // Elastic
  elastic: {
    duration: 500,
    easing: Easing.elastic(1.2),
  } as WithTimingConfig,
};

/**
 * Micro-interaction animation values
 */
export const ANIMATIONS = {
  // Press/tap scale
  tapScale: {
    from: 1.0,
    to: 0.96,
    duration: 100,
  },
  
  // Long press scale
  longPressScale: {
    from: 1.0,
    to: 0.98,
    duration: 400,
  },
  
  // Success bounce
  successBounce: {
    from: 1.0,
    peak: 1.15,
    to: 1.0,
    duration: 400,
  },
  
  // Loading pulse
  loadingPulse: {
    from: 0.9,
    to: 1.0,
    duration: 1000,
  },
  
  // Shimmer
  shimmer: {
    from: -1,
    to: 1,
    duration: 1500,
  },
  
  // Fade in
  fadeIn: {
    from: 0,
    to: 1,
    duration: 300,
  },
  
  // Slide up
  slideUp: {
    from: 50,
    to: 0,
    duration: 350,
  },
  
  // Rotate
  rotate: {
    from: 0,
    to: 360,
    duration: 1000,
  },
  
  // Glow pulse
  glowPulse: {
    from: 0.3,
    to: 0.7,
    duration: 1200,
  },
};

/**
 * Easings for Material Design
 */
export const M3_EASINGS = {
  standard: Easing.bezier(0.2, 0.0, 0, 1.0),
  emphasized: Easing.bezier(0.2, 0.0, 0, 1.0),
  emphasized_decelerate: Easing.bezier(0.05, 0.7, 0.1, 1.0),
  emphasized_accelerate: Easing.bezier(0.3, 0.0, 0.8, 0.15),
  legacy: Easing.bezier(0.4, 0.0, 0.2, 1),
  legacy_decelerate: Easing.bezier(0.0, 0.0, 0.2, 1),
  legacy_accelerate: Easing.bezier(0.4, 0.0, 1, 1),
};

/**
 * Duration tokens (Material 3)
 */
export const M3_DURATIONS = {
  short1: 50,
  short2: 100,
  short3: 150,
  short4: 200,
  medium1: 250,
  medium2: 300,
  medium3: 350,
  medium4: 400,
  long1: 450,
  long2: 500,
  long3: 550,
  long4: 600,
  extraLong1: 700,
  extraLong2: 800,
  extraLong3: 900,
  extraLong4: 1000,
};
