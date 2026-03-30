import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { useTheme, spacing, borderRadius } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
export function SkeletonBubble() {
    const { theme } = useTheme();
    const opacity = useRef(new Animated.Value(0.3)).current;
  
  
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: 0.7,
                    duration: 800,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0.3,
                    duration: 800,
                    useNativeDriver: true,
                }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, []);

    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginVertical: spacing.xs, paddingHorizontal: 0, alignSelf: 'flex-start' }}>
            <View style={[styles.avatarContainer, { backgroundColor: theme.colors.secondary, opacity: 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="person" size={24} color={theme.colors.primary} />
            </View>
            <View style={[
                styles.bubble,
                {
                    backgroundColor: theme.colors.aiBubble,
                    borderBottomLeftRadius: 0,
                    borderWidth: 1,
                    width: width * 0.50,
                    borderColor: theme.colors.aiBubbleBorder
                }
            ]}>
                <Animated.View style={[styles.line, { width: '70%', backgroundColor: theme.colors.textMuted, opacity }]} />
                <Animated.View style={[styles.line, { width: '40%', backgroundColor: theme.colors.textMuted, opacity }]} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginVertical: spacing.xs,
        paddingHorizontal: spacing.md,
        alignSelf: 'flex-start',
    },
    avatarContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        marginRight: spacing.xs,
        marginBottom: 2,
    },
    bubble: {
        maxWidth: width * 0.75,
        padding: spacing.sm,
        borderRadius: borderRadius.lg,
        gap: 8,
    },
    line: {
        height: 12,
        borderRadius: 6,
    }
});
