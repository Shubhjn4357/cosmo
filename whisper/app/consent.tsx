/**
 * Whisper App - Consent Screen
 * First-time user consent for terms and data collection
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Switch,
    BackHandler,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

// Terms content (abbreviated for display)
const TERMS_SUMMARY = `
By using Whisper AI, you agree to our Terms of Service:

• Data Collection: We collect chat data, images, and usage patterns to improve our AI models.

• AI Training: Your anonymized interactions may be used to train and enhance our AI systems.

• No Liability: Whisper AI is provided "as is". Developers are not liable for AI responses or actions taken based on them.

• Subscription: Free tier (20 tokens/month), Pro tier (1000 tokens/month).

• Content: You own your content. AI-generated content is provided for your use.

• Privacy: We respect your privacy and allow data deletion requests.

Full terms available in app settings.
`;

export default function ConsentScreen() {
    const { theme } = useTheme();
    const router = useRouter();
    const { acceptConsent } = useAuth();
    const [dataCollectionConsent, setDataCollectionConsent] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Handle back press - exit app
    React.useEffect(() => {
        const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
            handleDecline();
            return true;
        });

        return () => backHandler.remove();
    }, []);

    const handleAccept = async () => {
        setIsSubmitting(true);
        try {
            const success = await acceptConsent(dataCollectionConsent);
            if (success) {
                router.replace('/auth/login');
            }
        } catch (error) {
            Alert.alert('Error', 'Failed to save consent. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDecline = () => {
        Alert.alert(
            'Consent Required',
            'You must accept the terms to use Whisper AI. The app will close.',
            [
                { text: 'Go Back', style: 'cancel' },
                {
                    text: 'Exit App',
                    style: 'destructive',
                    onPress: () => BackHandler.exitApp(),
                },
            ]
        );
    };

    return (
        <LinearGradient
            colors={[theme.colors.background, theme.colors.surface]}
            style={styles.container}
        >
            <SafeAreaView style={styles.safeArea}>
                {/* Header */}
                <View style={styles.header}>
                    <Ionicons name="shield-checkmark" size={48} color={theme.colors.primary} />
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        Terms & Consent
                    </Text>
                    <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
                        Please review and accept our terms
                    </Text>
                </View>

                {/* Terms Content */}
                <View style={[styles.termsCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                    <ScrollView style={styles.termsScroll} showsVerticalScrollIndicator={false}>
                        <Text style={[styles.termsText, { color: theme.colors.text }]}>
                            {TERMS_SUMMARY}
                        </Text>
                    </ScrollView>
                </View>

                {/* Data Collection Toggle */}
                <View style={[styles.optionCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                    <View style={styles.optionContent}>
                        <Ionicons name="analytics" size={24} color={theme.colors.primary} />
                        <View style={styles.optionText}>
                            <Text style={[styles.optionTitle, { color: theme.colors.text }]}>
                                Help Improve AI
                            </Text>
                            <Text style={[styles.optionDesc, { color: theme.colors.textMuted }]}>
                                Allow anonymous data to be used for AI training
                            </Text>
                        </View>
                    </View>
                    <Switch
                        value={dataCollectionConsent}
                        onValueChange={setDataCollectionConsent}
                        trackColor={{ false: theme.colors.surfaceLight, true: theme.colors.primary + '60' }}
                        thumbColor={dataCollectionConsent ? theme.colors.primary : theme.colors.textMuted}
                    />
                </View>

                {/* Action Buttons */}
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[styles.declineBtn, { borderColor: theme.colors.error }]}
                        onPress={handleDecline}
                    >
                        <Text style={[styles.declineText, { color: theme.colors.error }]}>
                            Decline
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.acceptBtn, { backgroundColor: theme.colors.primary }]}
                        onPress={handleAccept}
                        disabled={isSubmitting}
                    >
                        <Text style={styles.acceptText}>
                            {isSubmitting ? 'Processing...' : 'I Agree'}
                        </Text>
                        <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    </TouchableOpacity>
                </View>

                {/* Footer Note */}
                <Text style={[styles.footerNote, { color: theme.colors.textMuted }]}>
                    By clicking "I Agree", you accept our Terms of Service and Privacy Policy.
                </Text>
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
        paddingHorizontal: spacing.lg,
    },
    header: {
        alignItems: 'center',
        paddingVertical: spacing.xl,
    },
    title: {
        fontSize: fontSize.xxl,
        fontWeight: '700',
        marginTop: spacing.md,
    },
    subtitle: {
        fontSize: fontSize.md,
        marginTop: spacing.xs,
    },
    termsCard: {
        flex: 1,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        padding: spacing.md,
        marginBottom: spacing.lg,
    },
    termsScroll: {
        flex: 1,
    },
    termsText: {
        fontSize: fontSize.sm,
        lineHeight: 22,
    },
    optionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        padding: spacing.md,
        marginBottom: spacing.lg,
    },
    optionContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: spacing.md,
    },
    optionText: {
        marginLeft: spacing.md,
        flex: 1,
    },
    optionTitle: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    optionDesc: {
        fontSize: fontSize.xs,
        marginTop: 2,
    },
    actions: {
        flexDirection: 'row',
        gap: spacing.md,
        marginBottom: spacing.md,
    },
    declineBtn: {
        flex: 1,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 2,
        alignItems: 'center',
    },
    declineText: {
        fontSize: fontSize.md,
        fontWeight: '600',
    },
    acceptBtn: {
        flex: 2,
        flexDirection: 'row',
        paddingVertical: spacing.md,
        borderRadius: borderRadius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    acceptText: {
        color: '#fff',
        fontSize: fontSize.md,
        fontWeight: '700',
    },
    footerNote: {
        fontSize: fontSize.xs,
        textAlign: 'center',
        marginBottom: spacing.lg,
    },
});
