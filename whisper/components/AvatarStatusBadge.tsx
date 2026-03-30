import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useTheme } from '@/constants/theme';

interface AvatarStatusBadgeProps {
    status: 'online' | 'offline' | 'connecting';
    children: React.ReactNode;
}

export function AvatarStatusBadge({ status, children }: AvatarStatusBadgeProps) {
    const { theme } = useTheme();
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (status === 'connecting') {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.2,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [status]);

    const getStatusColor = () => {
        switch (status) {
            case 'online': return '#10B981'; // Green
            case 'offline': return '#EF4444'; // Red
            case 'connecting': return '#F59E0B'; // Yellow
            default: return '#9CA3AF';
        }
    };

    return (
        <View style={styles.container}>
            {children}
            <View style={styles.badgeContainer}>
                {status === 'connecting' && (
                    <Animated.View
                        style={[
                            styles.pulseRing,
                            {
                                borderColor: getStatusColor(),
                                transform: [{ scale: pulseAnim }],
                                opacity: pulseAnim.interpolate({
                                    inputRange: [1, 1.2],
                                    outputRange: [0.6, 0],
                                }),
                            },
                        ]}
                    />
                )}
                <View
                    style={[
                        styles.badge,
                        {
                            backgroundColor: getStatusColor(),
                            borderColor: theme.colors.background,
                        },
                    ]}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'relative',
    },
    badgeContainer: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 12,
        height: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badge: {
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
    },
    pulseRing: {
        position: 'absolute',
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
    },
});
