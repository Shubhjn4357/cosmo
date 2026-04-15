/**
 * Cosmo AI — Animation Constants & Presets
 * Reusable Animated.timing/spring configs for consistent motion across the app.
 */

import { Animated, Easing } from 'react-native';

// ─── Spring Presets ───────────────────────────────────────────────────────────

export const SPRING_SNAPPY = {
    tension: 90,
    friction: 12,
    useNativeDriver: true,
};

export const SPRING_GENTLE = {
    tension: 55,
    friction: 14,
    useNativeDriver: true,
};

export const SPRING_BOUNCY = {
    tension: 120,
    friction: 8,
    useNativeDriver: true,
};

// ─── Timing Presets ──────────────────────────────────────────────────────────

export const TIMING_FAST = (toValue: number) => ({
    toValue,
    duration: 180,
    easing: Easing.out(Easing.ease),
    useNativeDriver: true,
});

export const TIMING_STANDARD = (toValue: number) => ({
    toValue,
    duration: 280,
    easing: Easing.bezier(0.4, 0, 0.2, 1),
    useNativeDriver: true,
});

export const TIMING_SLOW = (toValue: number) => ({
    toValue,
    duration: 420,
    easing: Easing.bezier(0.4, 0, 0.2, 1),
    useNativeDriver: true,
});

// ─── Animation Helpers ────────────────────────────────────────────────────────

/** Fade in: 0 → 1 */
export function fadeIn(anim: Animated.Value, duration = 260) {
    return Animated.timing(anim, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
    });
}

/** Fade out: 1 → 0 */
export function fadeOut(anim: Animated.Value, duration = 200) {
    return Animated.timing(anim, {
        toValue: 0,
        duration,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
    });
}

/** Slide in from bottom */
export function slideUp(anim: Animated.Value, from = 40) {
    anim.setValue(from);
    return Animated.spring(anim, { toValue: 0, ...SPRING_SNAPPY });
}

/** Scale pop-in */
export function scalePop(anim: Animated.Value) {
    anim.setValue(0.88);
    return Animated.spring(anim, { toValue: 1, ...SPRING_BOUNCY });
}

/** Pulse loop — for glowing elements */
export function pulseLoop(anim: Animated.Value, min = 0.7, max = 1.0): Animated.CompositeAnimation {
    return Animated.loop(
        Animated.sequence([
            Animated.timing(anim, { toValue: max, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(anim, { toValue: min, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
    );
}

/** Stagger children entrance */
export function staggerEntrance(animations: Animated.CompositeAnimation[], delay = 60) {
    return Animated.stagger(delay, animations);
}

/** Combined fade-up entrance for cards/list items */
export function entranceAnimation(
    opacity: Animated.Value,
    translateY: Animated.Value,
    delay = 0,
) {
    opacity.setValue(0);
    translateY.setValue(18);
    return Animated.parallel([
        Animated.timing(opacity, {
            toValue: 1,
            duration: 320,
            delay,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
        }),
        Animated.spring(translateY, {
            toValue: 0,
            delay,
            ...SPRING_GENTLE,
        }),
    ]);
}
