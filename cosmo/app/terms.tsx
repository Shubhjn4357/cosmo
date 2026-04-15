/**
 * Cosmo AI - Terms of Service Page
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

const TERMS_CONTENT = [
    {
        title: '1. Acceptance of Terms',
        content: 'By accessing or using Cosmo AI, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the app.',
    },
    {
        title: '2. Use of Service',
        content: 'Cosmo AI provides AI-powered chat, image generation, and document analysis services. You agree to use these services responsibly and in compliance with all applicable laws.',
    },
    {
        title: '3. User Content',
        content: 'You retain ownership of any content you submit. By using Cosmo AI, you grant us a license to process your content to provide our services. We do not claim ownership of your content.',
    },
    {
        title: '4. Prohibited Uses',
        content: 'You may not use Cosmo AI to: generate illegal, harmful, or offensive content; violate intellectual property rights; harass or harm others; or attempt to compromise our systems.',
    },
    {
        title: '5. AI-Generated Content',
        content: 'AI-generated content may not always be accurate. You are responsible for verifying any information before relying on it. Cosmo AI is not liable for decisions made based on AI output.',
    },
    {
        title: '6. Availability',
        content: 'Features may change over time as Cosmo AI evolves. We may add, remove, or adjust capabilities to improve reliability, safety, and overall product quality.',
    },
    {
        title: '7. Privacy',
        content: 'Your privacy is important to us. Please review our Privacy Policy for details on how we collect, use, and protect your data.',
    },
    {
        title: '8. Termination',
        content: 'We reserve the right to terminate or suspend your access to Cosmo AI at our discretion, without notice, for conduct that violates these terms.',
    },
    {
        title: '9. Changes to Terms',
        content: 'We may modify these terms at any time. Continued use of Cosmo AI after changes constitutes acceptance of the updated terms.',
    },
    {
        title: '10. Contact',
        content: 'If you have questions about these terms, please contact us at support@Cosmoai.app.',
    },
];

export default function TermsScreen() {
    const { theme } = useTheme();
    const router = useRouter();

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Terms of Service</Text>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={[styles.lastUpdated, { color: theme.colors.textMuted }]}>
                    Last Updated: December 2024
                </Text>

                {TERMS_CONTENT.map((section, index) => (
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
                    By using Cosmo AI, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
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
