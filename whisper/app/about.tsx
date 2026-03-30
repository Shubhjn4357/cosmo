/**
 * Whisper AI - About Page
 */

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

export default function AboutScreen() {
    const { theme } = useTheme();
    const router = useRouter();

    const features = [
        { icon: 'sparkles', title: 'AI Chat', desc: 'Intelligent conversations powered by advanced LLMs' },
        { icon: 'image', title: 'Image Generation', desc: 'Create stunning images from text descriptions' },
        { icon: 'swap-horizontal', title: 'Face Swap', desc: 'Advanced face swapping technology' },
        { icon: 'resize', title: 'Image Upscaling', desc: 'Enhance images to 2K/4K resolution' },
        { icon: 'chatbubbles', title: 'Roleplay', desc: 'Interactive character conversations' },
        { icon: 'document-text', title: 'Document Analysis', desc: 'Extract insights from PDFs and documents' },
    ];

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>About</Text>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {/* Logo & Title */}
                <View style={styles.logoSection}>
                    <View style={[styles.logoContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                        <Ionicons name="sparkles" size={48} color={theme.colors.primary} />
                    </View>
                    <Text style={[styles.appName, { color: theme.colors.text }]}>Whisper AI</Text>
                    <Text style={[styles.version, { color: theme.colors.textMuted }]}>Version 3.4.5b</Text>
                    <Text style={[styles.tagline, { color: theme.colors.textSecondary }]}>
                        Your Personal AI Assistant
                    </Text>
                </View>

                {/* Description */}
                <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.description, { color: theme.colors.text }]}>
                        Whisper AI is a powerful, privacy-focused AI assistant that runs on-device and in the cloud. 
                        Built with cutting-edge machine learning technology, Whisper helps you with chat, image generation, 
                        document analysis, and more.
                    </Text>
                </View>

                {/* Features */}
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Features</Text>
                <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                    {features.map((feature, index) => (
                        <View key={feature.title}>
                            <View style={styles.featureRow}>
                                <View style={[styles.featureIcon, { backgroundColor: theme.colors.primary + '20' }]}>
                                    <Ionicons name={feature.icon as any} size={20} color={theme.colors.primary} />
                                </View>
                                <View style={styles.featureInfo}>
                                    <Text style={[styles.featureTitle, { color: theme.colors.text }]}>
                                        {feature.title}
                                    </Text>
                                    <Text style={[styles.featureDesc, { color: theme.colors.textMuted }]}>
                                        {feature.desc}
                                    </Text>
                                </View>
                            </View>
                            {index < features.length - 1 && (
                                <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />
                            )}
                        </View>
                    ))}
                </View>

                {/* Links */}
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Connect</Text>
                <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                    <TouchableOpacity 
                        style={styles.linkRow}
                        onPress={() => Linking.openURL('https://github.com/Whisperai')}
                    >
                        <Ionicons name="logo-github" size={20} color={theme.colors.text} />
                        <Text style={[styles.linkText, { color: theme.colors.text }]}>GitHub</Text>
                        <Ionicons name="open-outline" size={16} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                    <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />
                    <TouchableOpacity 
                        style={styles.linkRow}
                        onPress={() => Linking.openURL('https://twitter.com/Whisperai')}
                    >
                        <Ionicons name="logo-twitter" size={20} color={theme.colors.text} />
                        <Text style={[styles.linkText, { color: theme.colors.text }]}>Twitter</Text>
                        <Ionicons name="open-outline" size={16} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                    <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />
                    <TouchableOpacity 
                        style={styles.linkRow}
                        onPress={() => Linking.openURL('mailto:support@Whisperai.app')}
                    >
                        <Ionicons name="mail-outline" size={20} color={theme.colors.text} />
                        <Text style={[styles.linkText, { color: theme.colors.text }]}>Contact Support</Text>
                        <Ionicons name="open-outline" size={16} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                </View>

                {/* Copyright */}
                <Text style={[styles.copyright, { color: theme.colors.textMuted }]}>
                    © 2024 Whisper AI. All rights reserved.
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    backButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        fontSize: fontSize.lg,
        fontWeight: '600',
        marginLeft: spacing.sm,
    },
    content: {
        padding: spacing.lg,
    },
    logoSection: {
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    logoContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.md,
    },
    appName: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
    },
    version: {
        fontSize: fontSize.sm,
        marginTop: 4,
    },
    tagline: {
        fontSize: fontSize.md,
        marginTop: spacing.sm,
    },
    card: {
        borderRadius: borderRadius.lg,
        padding: spacing.md,
        marginBottom: spacing.lg,
    },
    description: {
        fontSize: fontSize.md,
        lineHeight: 24,
    },
    sectionTitle: {
        fontSize: fontSize.md,
        fontWeight: '600',
        marginBottom: spacing.sm,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm,
    },
    featureIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    featureInfo: {
        flex: 1,
        marginLeft: spacing.md,
    },
    featureTitle: {
        fontSize: fontSize.md,
        fontWeight: '500',
    },
    featureDesc: {
        fontSize: fontSize.sm,
        marginTop: 2,
    },
    divider: {
        height: 1,
    },
    linkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.md,
        gap: spacing.md,
    },
    linkText: {
        flex: 1,
        fontSize: fontSize.md,
    },
    copyright: {
        textAlign: 'center',
        fontSize: fontSize.sm,
        marginTop: spacing.lg,
    },
});
