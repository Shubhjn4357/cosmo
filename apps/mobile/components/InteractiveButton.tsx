import React, { useState } from 'react';
import {
    TouchableOpacity,
    TouchableOpacityProps,
    Text,
    View,
    StyleSheet,
    Modal,
    Pressable,
    Platform,
    ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme, borderRadius, fontSize, spacing } from '@/constants/theme';

interface InteractiveButtonProps extends TouchableOpacityProps {
    tooltip?: string;
    hapticFeedback?: boolean;
    scaleOnPress?: boolean;
}

export function InteractiveButton({
    children,
    onPress,
    onLongPress,
    tooltip,
    hapticFeedback = true,
    scaleOnPress = true,
    style,
    ...props
}: InteractiveButtonProps) {
    const { theme, isDark } = useTheme();
    const [tooltipVisible, setTooltipVisible] = useState(false);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0, width: 0, height: 0 });
    const buttonRef = React.useRef<View>(null);

    const safeHaptic = async (style: Haptics.ImpactFeedbackStyle) => {
        if (Platform.OS === 'web') return; // Skip on web
        try {
            await Haptics.impactAsync(style);
        } catch (error) {
            // Ignore haptic errors (e.g. not available on device/simulator)
            // console.warn('Haptics not available');
        }
    };

    const handlePress = (e: any) => {
        if (hapticFeedback) {
            safeHaptic(Haptics.ImpactFeedbackStyle.Light);
        }
        onPress?.(e);
    };

    const handleLongPress = (e: any) => {
        if (hapticFeedback) {
            safeHaptic(Haptics.ImpactFeedbackStyle.Medium);
        }

        if (tooltip) {
            buttonRef.current?.measure((x, y, width, height, pageX, pageY) => {
                setTooltipPos({ x: pageX, y: pageY, width, height });
                setTooltipVisible(true);
            });
        }

        onLongPress?.(e);
    };

    return (
        <>
            <TouchableOpacity
                ref={buttonRef}
                onPress={handlePress}
                onLongPress={handleLongPress}
                activeOpacity={0.7}
                style={style}
                {...props}
            >
                {children}
            </TouchableOpacity>

            {/* Simple Tooltip Overlay */}
            <Modal
                visible={tooltipVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setTooltipVisible(false)}
            >
                <Pressable
                    style={styles.modalOverlay}
                    onPress={() => setTooltipVisible(false)}
                >
                    <View
                        style={[
                            styles.tooltipContainer,
                            {
                                top: tooltipPos.y - 45, // Position above button
                                left: tooltipPos.x + (tooltipPos.width / 2) - 10, // Center roughly - will be adjusted by flex
                                transform: [{ translateX: -50 }], // Center horizontally
                                backgroundColor: isDark ? '#333' : '#fff',
                                borderColor: theme.colors.surfaceBorder,
                                shadowColor: '#000',
                            }
                        ]}
                    >
                        <Text style={[styles.tooltipText, { color: theme.colors.text }]}>
                            {tooltip}
                        </Text>
                        <View style={[
                            styles.tooltipArrow,
                            {
                                borderTopColor: isDark ? '#333' : '#fff',
                                borderLeftColor: 'transparent',
                                borderRightColor: 'transparent',
                                borderBottomColor: 'transparent',
                            }
                        ]} />
                    </View>
                </Pressable>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        // backgroundColor: 'rgba(0,0,0,0.1)', // Debugging
    },
    tooltipContainer: {
        position: 'absolute',
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: borderRadius.sm,
        borderWidth: 1,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 5,
        alignItems: 'center',
        minWidth: 60,
        zIndex: 9999,
    },
    tooltipText: {
        fontSize: 12,
        fontWeight: '600',
        textAlign: 'center',
    },
    tooltipArrow: {
        position: 'absolute',
        bottom: -6,
        left: '50%',
        marginLeft: -6,
        width: 0,
        height: 0,
        borderWidth: 6,
    },
});
