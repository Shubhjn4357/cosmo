/**
 * Whisper App - Buy Me a Coffee Popup
 * Shows daily reminder for non-admin users to support the project
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Linking,
    Image,
    Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { useAuth } from '@/hooks';

const BMC_URL = 'https://buymeacoffee.com/shubhjn';
const STORAGE_KEY = 'Whisper_coffee_popup_shown_date';

interface CoffeePopupProps {
    visible: boolean;
    onClose: () => void;
}

function CoffeePopupContent({ visible, onClose }: CoffeePopupProps) {
    const { theme, isDark } = useTheme();
    const scaleAnim = React.useRef(new Animated.Value(0.8)).current;
    const fadeAnim = React.useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    friction: 6,
                    tension: 80,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible]);

    const handleBuyCoffee = () => {
        Linking.openURL(BMC_URL);
        onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <Animated.View
                    style={[
                        styles.container,
                        {
                            backgroundColor: isDark ? '#1E2535' : '#FFFFFF',
                            transform: [{ scale: scaleAnim }],
                            opacity: fadeAnim,
                        },
                    ]}
                >
                    {/* Close button */}
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Ionicons name="close" size={24} color={theme.colors.textMuted} />
                    </TouchableOpacity>

                    {/* Coffee icon */}
                    <View style={[styles.iconContainer, { backgroundColor: '#FFDD00' + '30' }]}>
                        <Text style={styles.coffeeEmoji}>☕</Text>
                    </View>

                    {/* Title */}
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        Enjoying Whisper AI?
                    </Text>

                    {/* Description */}
                    <Text style={[styles.description, { color: theme.colors.textMuted }]}>
                        Your support helps keep Whisper AI free and constantly improving! 
                        A small coffee goes a long way 💜
                    </Text>

                    {/* Benefits */}
                    <View style={styles.benefits}>
                        <View style={styles.benefitRow}>
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                            <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                                Support indie development
                            </Text>
                        </View>
                        <View style={styles.benefitRow}>
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                            <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                                Help fund server costs
                            </Text>
                        </View>
                        <View style={styles.benefitRow}>
                            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                            <Text style={[styles.benefitText, { color: theme.colors.text }]}>
                                Get a warm fuzzy feeling
                            </Text>
                        </View>
                    </View>

                    {/* Buy Coffee Button */}
                    <TouchableOpacity
                        style={[styles.buyButton, { backgroundColor: '#FFDD00' }]}
                        onPress={handleBuyCoffee}
                    >
                        <Text style={styles.buyButtonEmoji}>☕</Text>
                        <Text style={styles.buyButtonText}>Buy me a coffee</Text>
                    </TouchableOpacity>

                    {/* Maybe later */}
                    <TouchableOpacity style={styles.laterButton} onPress={onClose}>
                        <Text style={[styles.laterText, { color: theme.colors.textMuted }]}>
                            Maybe later
                        </Text>
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </Modal>
    );
}

export function useCoffeePopup() {
    const [showPopup, setShowPopup] = useState(false);
    const { profile } = useAuth();

    useEffect(() => {
        checkAndShowPopup();
    }, [profile]);

    const checkAndShowPopup = async () => {
        try {
            // Don't show for admins
            if (profile?.is_admin) {
                return;
            }

            // Check if popup was shown today
            const lastShownDate = await AsyncStorage.getItem(STORAGE_KEY);
            const today = new Date().toDateString();

            if (lastShownDate !== today) {
                // Wait 3 seconds before showing
                setTimeout(() => {
                    setShowPopup(true);
                    AsyncStorage.setItem(STORAGE_KEY, today);
                }, 3000);
            }
        } catch (error) {
            console.error('Error checking coffee popup:', error);
        }
    };

    const closePopup = () => {
        setShowPopup(false);
    };

    return {
        showPopup,
        closePopup,
        CoffeePopup: () => (
            <CoffeePopupContent visible={showPopup} onClose={closePopup} />
        ),
    };
}

export function CoffeeButton() {
    const { theme } = useTheme();

    const handlePress = () => {
        Linking.openURL(BMC_URL);
    };

    return (
        <TouchableOpacity
            style={[styles.coffeeSettingsButton, { backgroundColor: '#FFDD00' + '20' }]}
            onPress={handlePress}
        >
            <Text style={styles.coffeeButtonEmoji}>☕</Text>
            <Text style={[styles.coffeeButtonText, { color: theme.colors.text }]}>
                Buy Me a Coffee
            </Text>
            <Ionicons name="open-outline" size={16} color={theme.colors.textMuted} />
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
    },
    container: {
        width: '100%',
        maxWidth: 340,
        borderRadius: borderRadius.xl,
        padding: spacing.xl,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
    },
    closeButton: {
        position: 'absolute',
        top: spacing.md,
        right: spacing.md,
        padding: spacing.xs,
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.md,
    },
    coffeeEmoji: {
        fontSize: 40,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        marginBottom: spacing.sm,
        textAlign: 'center',
    },
    description: {
        fontSize: fontSize.md,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: spacing.lg,
    },
    benefits: {
        width: '100%',
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    benefitRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    benefitText: {
        fontSize: fontSize.sm,
    },
    buyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
        borderRadius: borderRadius.md,
        width: '100%',
        gap: spacing.sm,
    },
    buyButtonEmoji: {
        fontSize: 20,
    },
    buyButtonText: {
        color: '#000000',
        fontSize: fontSize.md,
        fontWeight: '700',
    },
    laterButton: {
        marginTop: spacing.md,
        padding: spacing.sm,
    },
    laterText: {
        fontSize: fontSize.sm,
    },
    coffeeSettingsButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        gap: spacing.sm,
    },
    coffeeButtonEmoji: {
        fontSize: 20,
    },
    coffeeButtonText: {
        flex: 1,
        fontSize: fontSize.md,
        fontWeight: '600',
    },
});

export default CoffeePopupContent;
