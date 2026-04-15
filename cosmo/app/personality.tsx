/**
 * Cosmo App - Personality Settings Screen
 * Configure AI personality, relationship, and language
 * Now includes 22 predefined character personalities!
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    TextInput,
    Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { usePersonality } from '@/hooks/usePersonality';
import { PersonalityStyle, RelationshipType, LanguagePreference } from '@/types';
import { useToast } from '@/components/Toast';
import { BUILT_IN_CHARACTERS } from '@/services/roleplayService';

// Personality style options
const PERSONALITY_STYLES: { value: PersonalityStyle; label: string; emoji: string; desc: string }[] = [
    { value: 'polite', label: 'Polite', emoji: '🎩', desc: 'Respectful & formal' },
    { value: 'friendly', label: 'Friendly', emoji: '😊', desc: 'Warm & casual' },
    { value: 'sweet', label: 'Sweet', emoji: '🥰', desc: 'Affectionate & caring' },
    { value: 'witty', label: 'Witty', emoji: '😏', desc: 'Clever & humorous' },
    { value: 'sarcastic', label: 'Sarcastic', emoji: '😒', desc: 'Ironic & dry humor' },
    { value: 'cynical', label: 'Cynical', emoji: '🙄', desc: 'Skeptical & blunt' },
    { value: 'playful', label: 'Playful', emoji: '😜', desc: 'Fun & teasing' },
    { value: 'flirty', label: 'Flirty', emoji: '😘', desc: 'Charming & flirtatious' },
    { value: 'naughty', label: 'Naughty', emoji: '😈', desc: 'Mischievous & bold' },
    { value: 'romantic', label: 'Romantic', emoji: '💕', desc: 'Loving & passionate' },
    { value: 'serious', label: 'Serious', emoji: '🧐', desc: 'Professional & focused' },
    { value: 'motivational', label: 'Motivational', emoji: '💪', desc: 'Encouraging & inspiring' },
];

// Relationship options
const RELATIONSHIPS: { value: RelationshipType; label: string; emoji: string }[] = [
    { value: 'assistant', label: 'Assistant', emoji: '🤖' },
    { value: 'friend', label: 'Friend', emoji: '👋' },
    { value: 'bestfriend', label: 'Best Friend', emoji: '🤝' },
    { value: 'mentor', label: 'Mentor', emoji: '🎓' },
    { value: 'family', label: 'Family', emoji: '👨‍👩‍👧' },
    { value: 'partner', label: 'Partner', emoji: '💑' },
    { value: 'custom', label: 'Custom', emoji: '✨' },
];

// Language options
const LANGUAGES: { value: LanguagePreference; label: string; emoji: string }[] = [
    { value: 'english', label: 'English', emoji: '🇬🇧' },
    { value: 'hindi', label: 'हिंदी', emoji: '🇮🇳' },
    { value: 'hinglish', label: 'Hinglish', emoji: '🇮🇳🇬🇧' },
];

export default function PersonalityScreen() {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const toast = useToast();
    const { personality, savePersonality, isLoading } = usePersonality();

    // Show preset tab
    const [showPresets, setShowPresets] = useState(false);

    // Local state for editing
    const [style, setStyle] = useState<PersonalityStyle>(personality.style);
    const [relationship, setRelationship] = useState<RelationshipType>(personality.relationship);
    const [language, setLanguage] = useState<LanguagePreference>(personality.language);
    const [customName, setCustomName] = useState(personality.customName || '');
    const [customPrompt, setCustomPrompt] = useState(personality.customPrompt || '');
    const [enableEmoji, setEnableEmoji] = useState(personality.enableEmoji);
    const [formalityLevel, setFormalityLevel] = useState(personality.formalityLevel);

    // Update local state when personality loads
    useEffect(() => {
        if (!isLoading) {
            setStyle(personality.style);
            setRelationship(personality.relationship);
            setLanguage(personality.language);
            setCustomName(personality.customName || '');
            setCustomPrompt(personality.customPrompt || '');
            setEnableEmoji(personality.enableEmoji);
            setFormalityLevel(personality.formalityLevel);
        }
    }, [isLoading, personality]);

    const handleSave = async () => {
        const success = await savePersonality({
            style,
            relationship,
            language,
            voiceStyle: personality.voiceStyle,
            customName: customName || undefined,
            customPrompt: customPrompt || undefined,
            enableEmoji,
            formalityLevel,
        });

        if (success) {
            toast.success('Saved! ✨', 'Your AI personality has been updated.');
            router.back();
        } else {
            toast.error('Error', 'Failed to save settings.');
        }
    };

    const bottomPadding = 60 + Math.max(insets.bottom, 10) + spacing.xl;

    // Apply preset character personality
    const applyPreset = async (characterId: string) => {
        const character = BUILT_IN_CHARACTERS.find(c => c.id === characterId);
        if (!character) return;

        // Map character to personality settings
        const newSettings = {
            style: character.tags.includes('romantic') ? 'romantic' as PersonalityStyle :
                character.tags.includes('friendly') ? 'friendly' as PersonalityStyle :
                    character.tags.includes('witty') ? 'witty' as PersonalityStyle :
                        character.tags.includes('mysterious') ? 'serious' as PersonalityStyle : 'friendly' as PersonalityStyle,
            relationship: character.category === 'romantic' ? 'partner' as RelationshipType :
                character.category === 'companion' ? 'friend' as RelationshipType :
                    character.category === 'assistant' ? 'assistant' as RelationshipType : 'friend' as RelationshipType,
            language: personality.language,
            voiceStyle: personality.voiceStyle,
            customName: character.name,
            customPrompt: character.systemPrompt,
            enableEmoji: true,
            formalityLevel: character.category === 'romantic' || character.category === 'companion' ? 2 : 3,
        };

        const success = await savePersonality(newSettings);
        if (success) {
            toast.success(`Applied ${character.name}! ✨`, 'Personality updated successfully');
            // Update local state
            setStyle(newSettings.style);
            setRelationship(newSettings.relationship);
            setCustomName(newSettings.customName!);
            setCustomPrompt(newSettings.customPrompt!);
            setEnableEmoji(newSettings.enableEmoji);
            setFormalityLevel(newSettings.formalityLevel);
            // Switch back to custom tab
            setShowPresets(false);
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                        AI Personality
                    </Text>
                    <TouchableOpacity onPress={handleSave} style={[styles.saveBtn, { backgroundColor: theme.colors.primary }]}>
                        <Text style={styles.saveBtnText}>Save</Text>
                    </TouchableOpacity>
                </View>

                {/* Tab Switcher */}
                <View style={[styles.tabContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                    <TouchableOpacity
                        style={[styles.tab, !showPresets && { backgroundColor: theme.colors.primary }]}
                        onPress={() => setShowPresets(false)}
                    >
                        <Text style={[styles.tabText, { color: !showPresets ? '#fff' : theme.colors.textMuted }]}>
                            Custom
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tab, showPresets && { backgroundColor: theme.colors.primary }]}
                        onPress={() => setShowPresets(true)}
                    >
                        <Text style={[styles.tabText, { color: showPresets ? '#fff' : theme.colors.textMuted }]}>
                            Presets ({BUILT_IN_CHARACTERS.length})
                        </Text>
                    </TouchableOpacity>
                </View>

                <ScrollView 
                    style={styles.scrollView}
                    contentContainerStyle={{ paddingBottom: bottomPadding }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Show either presets or custom settings */}
                    {showPresets ? (
                        /* PRESET CHARACTERS GRID */
                        <View style={styles.section}>
                            <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                                TAP ANY CHARACTER TO APPLY
                            </Text>
                            <View style={styles.presetsGrid}>
                                {BUILT_IN_CHARACTERS.map((character) => (
                                    <TouchableOpacity
                                        key={character.id}
                                        style={[
                                            styles.characterCard,
                                            {
                                                backgroundColor: theme.colors.surface,
                                                borderColor: theme.colors.surfaceBorder,
                                            },
                                        ]}
                                        onPress={() => applyPreset(character.id)}
                                    >
                                        <Image
                                            source={{ uri: character.avatar }}
                                            style={styles.characterAvatar}
                                        />
                                        {character.isNSFW && (
                                            <View style={styles.nsfwBadge}>
                                                <Text style={styles.nsfwText}>18+</Text>
                                            </View>
                                        )}
                                        <Text style={[styles.characterName, { color: theme.colors.text }]}>
                                            {character.name}
                                        </Text>
                                        <Text style={[styles.characterDesc, { color: theme.colors.textMuted }]} numberOfLines={2}>
                                            {character.description}
                                        </Text>
                                        <View style={styles.characterTags}>
                                            {character.tags.slice(0, 2).map((tag) => (
                                                <View
                                                    key={tag}
                                                    style={[styles.tag, { backgroundColor: theme.colors.primary + '20' }]}
                                                >
                                                    <Text style={[styles.tagText, { color: theme.colors.primary }]}>
                                                        {tag}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>
                                        <View style={[styles.applyButton, { backgroundColor: theme.colors.primary }]}>
                                            <Text style={styles.applyButtonText}>Apply</Text>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    ) : (
                        /* CUSTOM PERSONALITY SETTINGS */
                        <>
                    {/* Language Section */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            LANGUAGE
                        </Text>
                        <View style={styles.optionGrid}>
                            {LANGUAGES.map((lang) => (
                                <TouchableOpacity
                                    key={lang.value}
                                    style={[
                                        styles.optionCard,
                                        { 
                                            backgroundColor: language === lang.value 
                                                ? theme.colors.primary + '20' 
                                                : theme.colors.surface,
                                            borderColor: language === lang.value 
                                                ? theme.colors.primary 
                                                : theme.colors.surfaceBorder,
                                        }
                                    ]}
                                    onPress={() => setLanguage(lang.value)}
                                >
                                    <Text style={styles.optionEmoji}>{lang.emoji}</Text>
                                    <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
                                        {lang.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {/* Personality Style Section */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            PERSONALITY STYLE
                        </Text>
                        <View style={styles.optionGrid}>
                            {PERSONALITY_STYLES.map((p) => (
                                <TouchableOpacity
                                    key={p.value}
                                    style={[
                                        styles.styleCard,
                                        { 
                                            backgroundColor: style === p.value 
                                                ? theme.colors.primary + '20' 
                                                : theme.colors.surface,
                                            borderColor: style === p.value 
                                                ? theme.colors.primary 
                                                : theme.colors.surfaceBorder,
                                        }
                                    ]}
                                    onPress={() => setStyle(p.value)}
                                >
                                    <Text style={styles.styleEmoji}>{p.emoji}</Text>
                                    <Text style={[styles.styleLabel, { color: theme.colors.text }]}>
                                        {p.label}
                                    </Text>
                                    <Text style={[styles.styleDesc, { color: theme.colors.textMuted }]}>
                                        {p.desc}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {/* Relationship Section */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            RELATIONSHIP TYPE
                        </Text>
                        <View style={styles.optionGrid}>
                            {RELATIONSHIPS.map((rel) => (
                                <TouchableOpacity
                                    key={rel.value}
                                    style={[
                                        styles.optionCard,
                                        { 
                                            backgroundColor: relationship === rel.value 
                                                ? theme.colors.accent + '20' 
                                                : theme.colors.surface,
                                            borderColor: relationship === rel.value 
                                                ? theme.colors.accent 
                                                : theme.colors.surfaceBorder,
                                        }
                                    ]}
                                    onPress={() => setRelationship(rel.value)}
                                >
                                    <Text style={styles.optionEmoji}>{rel.emoji}</Text>
                                    <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
                                        {rel.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {/* Custom Name */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            AI NAME (OPTIONAL)
                        </Text>
                        <TextInput
                            style={[
                                styles.textInput,
                                { 
                                    backgroundColor: theme.colors.surface,
                                    borderColor: theme.colors.surfaceBorder,
                                    color: theme.colors.text,
                                }
                            ]}
                            value={customName}
                            onChangeText={setCustomName}
                            placeholder="e.g., Cosmo, Aria, Max..."
                            placeholderTextColor={theme.colors.textMuted}
                            maxLength={20}
                        />
                    </View>

                    {/* Custom Directions */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            CUSTOM INSTRUCTIONS
                        </Text>
                        <TextInput
                            style={[
                                styles.textInput,
                                {
                                    backgroundColor: theme.colors.surface,
                                    borderColor: theme.colors.surfaceBorder,
                                    color: theme.colors.text,
                                    height: 100,
                                    textAlignVertical: 'top',
                                }
                            ]}
                            value={customPrompt}
                            onChangeText={setCustomPrompt}
                            placeholder="Add specific instructions (e.g., 'Always define technical terms', 'Talk like a pirate')..."
                            placeholderTextColor={theme.colors.textMuted}
                            multiline
                            numberOfLines={4}
                            maxLength={500}
                        />
                    </View>

                    {/* Emoji Toggle */}
                    <View style={styles.section}>
                        <TouchableOpacity
                            style={[styles.toggleRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}
                            onPress={() => setEnableEmoji(!enableEmoji)}
                        >
                            <View style={styles.toggleInfo}>
                                <Text style={[styles.toggleLabel, { color: theme.colors.text }]}>
                                    Use Emojis 😊
                                </Text>
                                <Text style={[styles.toggleDesc, { color: theme.colors.textMuted }]}>
                                    AI will use emojis in responses
                                </Text>
                            </View>
                            <View style={[
                                styles.toggleSwitch,
                                { backgroundColor: enableEmoji ? theme.colors.success : theme.colors.surfaceLight }
                            ]}>
                                <View style={[
                                    styles.toggleKnob,
                                    { transform: [{ translateX: enableEmoji ? 20 : 0 }] }
                                ]} />
                            </View>
                        </TouchableOpacity>
                    </View>

                    {/* Formality Slider */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                            FORMALITY LEVEL
                        </Text>
                        <View style={[styles.sliderContainer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                            <Text style={[styles.sliderLabel, { color: theme.colors.textMuted }]}>Casual</Text>
                            <View style={styles.sliderTrack}>
                                {[1, 2, 3, 4, 5].map((level) => (
                                    <TouchableOpacity
                                        key={level}
                                        style={[
                                            styles.sliderDot,
                                            { 
                                                backgroundColor: formalityLevel >= level 
                                                    ? theme.colors.primary 
                                                    : theme.colors.surfaceLight 
                                            }
                                        ]}
                                        onPress={() => setFormalityLevel(level)}
                                    />
                                ))}
                            </View>
                            <Text style={[styles.sliderLabel, { color: theme.colors.textMuted }]}>Formal</Text>
                        </View>
                    </View>
                        </>
                    )}
                </ScrollView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    header: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
    },
    backBtn: { padding: spacing.xs },
    headerTitle: { fontSize: fontSize.xl, fontWeight: '700' },
    saveBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
    saveBtnText: { color: '#fff', fontWeight: '600', fontSize: fontSize.sm },
    scrollView: { flex: 1 },
    section: { paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
    sectionTitle: { fontSize: fontSize.xs, fontWeight: '600', marginBottom: spacing.sm, letterSpacing: 1 },
    optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    optionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
        borderWidth: 1.5,
    },
    optionEmoji: { fontSize: 18 },
    optionLabel: { fontSize: fontSize.sm, fontWeight: '500' },
    styleCard: {
        width: '47%',
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1.5,
        alignItems: 'center',
        gap: 4,
    },
    styleEmoji: { fontSize: 28 },
    styleLabel: { fontSize: fontSize.sm, fontWeight: '600' },
    styleDesc: { fontSize: fontSize.xs, textAlign: 'center' },
    textInput: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        fontSize: fontSize.md,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 1,
    },
    toggleInfo: { flex: 1 },
    toggleLabel: { fontSize: fontSize.md, fontWeight: '500' },
    toggleDesc: { fontSize: fontSize.xs, marginTop: 2 },
    toggleSwitch: {
        width: 50,
        height: 30,
        borderRadius: 15,
        padding: 2,
        justifyContent: 'center',
    },
    toggleKnob: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: '#fff',
    },
    sliderContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: borderRadius.md,
        borderWidth: 1,
        gap: spacing.sm,
    },
    sliderLabel: { fontSize: fontSize.xs },
    sliderTrack: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
    sliderDot: { width: 24, height: 24, borderRadius: 12 },

    // Tab switcher styles
    tabContainer: {
        flexDirection: 'row',
        marginHorizontal: spacing.lg,
        marginVertical: spacing.md,
        padding: 4,
        borderRadius: borderRadius.md,
        borderWidth: 1,
    },
    tab: {
        flex: 1,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.sm,
        alignItems: 'center',
    },
    tabText: {
        fontSize: fontSize.sm,
        fontWeight: '600',
    },

    // Preset characters grid
    presetsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.md,
    },
    characterCard: {
        width: '47%',
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1.5,
        alignItems: 'center',
        gap: spacing.xs,
    },
    characterAvatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        marginBottom: spacing.xs,
    },
    characterName: {
        fontSize: fontSize.md,
        fontWeight: '600',
        textAlign: 'center',
    },
    characterDesc: {
        fontSize: fontSize.xs,
        textAlign: 'center',
        minHeight: 32,
    },
    characterTags: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        justifyContent: 'center',
    },
    tag: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: borderRadius.sm,
    },
    tagText: {
        fontSize: 10,
        fontWeight: '600',
    },
    nsfwBadge: {
        position: 'absolute',
        top: spacing.md,
        right: spacing.md,
        backgroundColor: '#EF4444',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: borderRadius.sm,
    },
    nsfwText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    applyButton: {
        width: '100%',
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.md,
        alignItems: 'center',
        marginTop: spacing.xs,
    },
    applyButtonText: {
        color: '#fff',
        fontSize: fontSize.sm,
        fontWeight: '600',
    },
});
