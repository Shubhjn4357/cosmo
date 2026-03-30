/**
 * Whisper AI - Privacy Policy Page
 */

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

const PRIVACY_SECTIONS = [
    {
        title: 'Information We Collect',
        content: 'We collect information you provide directly (account info, messages, uploaded files) and automatically (device info, usage data). We minimize data collection to what is necessary for service operation.',
    },
    {
        title: 'How We Use Your Information',
        content: 'Your data is used to: provide and improve our services, personalize your experience, process payments, send important updates, and ensure security. We do not sell your personal data.',
    },
    {
        title: 'On-Device Processing',
        content: 'Whisper AI supports on-device AI processing. When using local models, your conversations stay on your device and are never sent to our servers.',
    },
    {
        title: 'Data Storage & Security',
        content: 'We use industry-standard encryption to protect your data in transit and at rest. Account data is stored securely using Supabase. We regularly review our security practices.',
    },
    {
        title: 'Third-Party Services',
        content: 'We use third-party services including: cloud AI providers (for server-based features), payment processors (Razorpay), and analytics. Each has their own privacy policies.',
    },
    {
        title: 'Your Rights',
        content: 'You have the right to: access your data, correct inaccuracies, delete your account, export your data, and opt out of marketing communications.',
    },
    {
        title: 'Data Retention',
        content: 'We retain your data only as long as necessary to provide our services. You can delete your account and associated data at any time from the settings.',
    },
    {
        title: "Children's Privacy",
        content: 'Whisper AI is not intended for users under 13. We do not knowingly collect personal information from children. If we learn of such collection, we will promptly delete it.',
    },
    {
        title: 'Policy Updates',
        content: 'We may update this policy periodically. We will notify you of material changes through the app or via email.',
    },
    {
        title: 'Contact Us',
        content: 'For privacy-related questions or to exercise your rights, contact us at privacy@Whisperai.app or support@Whisperai.app.',
    },
];

export default function PrivacyScreen() {
    const { theme } = useTheme();
    const router = useRouter();

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Privacy Policy</Text>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {/* Highlight */}
                <View style={[styles.highlight, { backgroundColor: theme.colors.success + '20' }]}>
                    <Ionicons name="shield-checkmark" size={24} color={theme.colors.success} />
                    <Text style={[styles.highlightText, { color: theme.colors.success }]}>
                        Your privacy is our priority. We only collect what's necessary.
                    </Text>
                </View>

                <Text style={[styles.lastUpdated, { color: theme.colors.textMuted }]}>
                    Last Updated: December 2024
                </Text>

                {PRIVACY_SECTIONS.map((section, index) => (
                    <View 
                        key={index} 
                        style={[styles.section, { backgroundColor: theme.colors.surface }]}
                    >
                        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                            {section.title}
                        </Text>
                        <Text style={[styles.sectionContent, { color: theme.colors.textSecondary }]}>
                            {section.content}
                        </Text>
                    </View>
                ))}

                <Text style={[styles.footer, { color: theme.colors.textMuted }]}>
                    By using Whisper AI, you consent to our privacy practices as described in this policy.
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
    highlight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: borderRadius.md,
        marginBottom: spacing.lg,
    },
    highlightText: {
        flex: 1,
        fontSize: fontSize.sm,
        fontWeight: '500',
    },
    lastUpdated: {
        fontSize: fontSize.sm,
        marginBottom: spacing.lg,
    },
    section: {
        borderRadius: borderRadius.md,
        padding: spacing.md,
        marginBottom: spacing.md,
    },
    sectionTitle: {
        fontSize: fontSize.md,
        fontWeight: '600',
        marginBottom: spacing.sm,
    },
    sectionContent: {
        fontSize: fontSize.sm,
        lineHeight: 22,
    },
    footer: {
        fontSize: fontSize.sm,
        textAlign: 'center',
        marginTop: spacing.lg,
        lineHeight: 20,
    },
});
