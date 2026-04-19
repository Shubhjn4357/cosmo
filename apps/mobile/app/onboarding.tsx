/**
 * Cosmo App - Onboarding Screen
 * Splash slider showing app features on first launch
 */

import React, { useState, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    FlatList,
    Animated,
    Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

const { width, height } = Dimensions.get('window');

interface OnboardingSlide {
    id: string;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    description: string;
    color: string;
}

const SLIDES: OnboardingSlide[] = [
    {
        id: '1',
        icon: 'chatbubbles',
        title: 'AI Chat Anywhere',
        description: 'Chat with powerful AI models online or download them for completely offline use. Your privacy, your choice.',
        color: '#6366F1',
    },
    {
        id: '2',
        icon: 'image',
        title: 'Create Stunning Images',
        description: 'Generate beautiful images from text descriptions. From art to photos, bring your imagination to life.',
        color: '#EC4899',
    },
    {
        id: '3',
        icon: 'document-text',
        title: 'Analyze Documents',
        description: 'Upload PDFs, images, and documents. Ask questions and get intelligent answers instantly.',
        color: '#10B981',
    },
    {
        id: '4',
        icon: 'sparkles',
        title: 'AI That Learns',
        description: 'Cosmo AI learns and improves over time. The more you use it, the smarter it becomes.',
        color: '#F59E0B', // Amber - new accent color
    },
];

export default function OnboardingScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const { completeOnboarding } = useAuth();
    const [currentIndex, setCurrentIndex] = useState(0);
    const flatListRef = useRef<FlatList>(null);
    const scrollX = useRef(new Animated.Value(0)).current;

    const handleNext = () => {
        if (currentIndex < SLIDES.length - 1) {
            flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
            setCurrentIndex(currentIndex + 1);
        }
    };

    const handleGetStarted = async () => {
        await completeOnboarding();
        router.replace('/consent');
    };

    const renderSlide = ({ item, index }: { item: OnboardingSlide; index: number }) => {
        return (
            <View style={styles.slide}>
                {/* Icon Container with Gradient */}
                <LinearGradient
                    colors={[item.color + '30', item.color + '10']}
                    style={styles.iconContainer}
                >
                    <View style={[styles.iconCircle, { backgroundColor: item.color + '20' }]}>
                        <Ionicons name={item.icon} size={80} color={item.color} />
                    </View>
                </LinearGradient>

                {/* Content */}
                <View style={styles.slideContent}>
                    <Text style={[styles.slideTitle, { color: theme.colors.text }]}>
                        {item.title}
                    </Text>
                    <Text style={[styles.slideDescription, { color: theme.colors.textMuted }]}>
                        {item.description}
                    </Text>
                </View>
            </View>
        );
    };

    const renderDots = () => {
        return (
            <View style={styles.dotsContainer}>
                {SLIDES.map((slide, index) => {
                    const inputRange = [
                        (index - 1) * width,
                        index * width,
                        (index + 1) * width,
                    ];

                    const dotWidth = scrollX.interpolate({
                        inputRange,
                        outputRange: [8, 24, 8],
                        extrapolate: 'clamp',
                    });

                    const opacity = scrollX.interpolate({
                        inputRange,
                        outputRange: [0.3, 1, 0.3],
                        extrapolate: 'clamp',
                    });

                    return (
                        <Animated.View
                            key={slide.id}
                            style={[
                                styles.dot,
                                {
                                    width: dotWidth,
                                    opacity,
                                    backgroundColor: theme.colors.primary,
                                },
                            ]}
                        />
                    );
                })}
            </View>
        );
    };

    const isLastSlide = currentIndex === SLIDES.length - 1;

    return (
        <LinearGradient
            colors={[theme.colors.background, theme.colors.surface]}
            style={styles.container}
        >
            <SafeAreaView style={styles.safeArea}>
                {/* Skip Button */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.skipBtn}
                        onPress={handleGetStarted}
                    >
                        <Text style={[styles.skipText, { color: theme.colors.textMuted }]}>
                            Skip
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Slides */}
                <Animated.FlatList
                    ref={flatListRef}
                    data={SLIDES}
                    renderItem={renderSlide}
                    keyExtractor={(item) => item.id}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    bounces={false}
                    onScroll={Animated.event(
                        [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                        { useNativeDriver: false }
                    )}
                    onMomentumScrollEnd={(e) => {
                        const index = Math.round(e.nativeEvent.contentOffset.x / width);
                        setCurrentIndex(index);
                    }}
                    scrollEventThrottle={16}
                />

                {/* Dots & Actions */}
                <View style={styles.footer}>
                    {renderDots()}

                    <View style={styles.actions}>
                        {isLastSlide ? (
                            <TouchableOpacity
                                style={[styles.getStartedBtn, { backgroundColor: theme.colors.primary }]}
                                onPress={handleGetStarted}
                            >
                                <Text style={styles.getStartedText}>Get Started</Text>
                                <Ionicons name="arrow-forward" size={20} color="#fff" />
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[styles.nextBtn, { backgroundColor: theme.colors.primary }]}
                                onPress={handleNext}
                            >
                                <Ionicons name="arrow-forward" size={24} color="#fff" />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </SafeAreaView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    safeArea: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
    },
    skipBtn: {
        padding: spacing.sm,
    },
    skipText: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    slide: {
        width,
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
    },
    iconContainer: {
        width: 200,
        height: 200,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.xxl,
    },
    iconCircle: {
        width: 160,
        height: 160,
        borderRadius: 80,
        alignItems: 'center',
        justifyContent: 'center',
    },
    slideContent: {
        alignItems: 'center',
    },
    slideTitle: {
        fontSize: 28,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: spacing.md,
    },
    slideDescription: {
        fontSize: fontSize.md,
        textAlign: 'center',
        lineHeight: 24,
        paddingHorizontal: spacing.lg,
    },
    footer: {
        paddingHorizontal: spacing.xl,
        paddingBottom: spacing.xxl,
    },
    dotsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    dot: {
        height: 8,
        borderRadius: 4,
        marginHorizontal: 4,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
    nextBtn: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 5,
    },
    getStartedBtn: {
        flexDirection: 'row',
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.xl,
        alignItems: 'center',
        gap: spacing.sm,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 5,
    },
    getStartedText: {
        color: '#fff',
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
});
