import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { UnifiedChatScreen } from '@/components/chat/UnifiedChatScreen';
import { borderRadius, fontSize, spacing, useTheme } from '@/constants/theme';
import { useAppPreferences } from '@/hooks';
import { characterService, type RoleplayCharacter } from '@/services/characterService';

function resolveAvatarSource(character: RoleplayCharacter) {
    const source = characterService.getAvatarSource(character);
    return typeof source === 'string' ? { uri: source } : source;
}

export default function RoleplayScreen() {
    const { theme } = useTheme();
    const { nsfwEnabled, setNsfwEnabled } = useAppPreferences();
    const [characters, setCharacters] = useState<RoleplayCharacter[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [selectedCharacter, setSelectedCharacter] = useState<RoleplayCharacter | null>(null);

    const loadCharacters = useCallback(async () => {
        setLoading(true);
        try {
            const nextCharacters = await characterService.getCharacters(nsfwEnabled);
            setCharacters(nextCharacters);
        } catch (error) {
            console.error('Failed to load roleplay characters:', error);
            setCharacters([]);
        } finally {
            setLoading(false);
        }
    }, [nsfwEnabled]);

    useEffect(() => {
        void loadCharacters();
    }, [loadCharacters]);

    const filteredCharacters = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return characters;

        return characters.filter((character) => (
            character.name.toLowerCase().includes(normalizedQuery)
            || character.description.toLowerCase().includes(normalizedQuery)
            || character.personality.toLowerCase().includes(normalizedQuery)
            || character.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
        ));
    }, [characters, query]);

    if (selectedCharacter) {
        return (
            <UnifiedChatScreen
                mode="roleplay"
                character={selectedCharacter}
                characterId={selectedCharacter.id}
                characterName={selectedCharacter.name}
                onBack={() => setSelectedCharacter(null)}
            />
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <View style={styles.header}>
                    <View style={styles.headerCopy}>
                        <Text style={[styles.title, { color: theme.colors.text }]}>Roleplay</Text>
                        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                            Pick one personality and the chat runtime stays in character.
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={[
                            styles.adultToggle,
                            {
                                backgroundColor: nsfwEnabled ? theme.colors.error + '18' : theme.colors.surface,
                                borderColor: nsfwEnabled ? theme.colors.error : theme.colors.surfaceBorder,
                            },
                        ]}
                        onPress={() => {
                            void setNsfwEnabled(!nsfwEnabled);
                        }}
                    >
                        <Text style={[styles.adultToggleText, { color: nsfwEnabled ? theme.colors.error : theme.colors.textMuted }]}>
                            18+
                        </Text>
                    </TouchableOpacity>
                </View>

                <View
                    style={[
                        styles.searchBox,
                        { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder },
                    ]}
                >
                    <Ionicons name="search" size={16} color={theme.colors.textMuted} />
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search personalities"
                        placeholderTextColor={theme.colors.textMuted}
                        style={[styles.searchInput, { color: theme.colors.text }]}
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => setQuery('')}>
                            <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>

                {loading ? (
                    <View style={styles.centerState}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text style={[styles.stateText, { color: theme.colors.textSecondary }]}>
                            Loading roleplay personalities...
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={filteredCharacters}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.listContent}
                        numColumns={2}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={(
                            <View style={styles.centerState}>
                                <Ionicons name="people-outline" size={36} color={theme.colors.textMuted} />
                                <Text style={[styles.stateTitle, { color: theme.colors.text }]}>No personalities found</Text>
                                <Text style={[styles.stateText, { color: theme.colors.textSecondary }]}>
                                    Try a different search or turn 18+ back on.
                                </Text>
                            </View>
                        )}
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={[
                                    styles.card,
                                    {
                                        backgroundColor: theme.colors.surface,
                                        borderColor: theme.colors.surfaceBorder,
                                    },
                                ]}
                                onPress={() => setSelectedCharacter(item)}
                            >
                                <View style={styles.cardTopRow}>
                                    <Image source={resolveAvatarSource(item)} style={styles.avatar} />
                                    {item.nsfw && (
                                        <View style={styles.badge}>
                                            <Text style={styles.badgeText}>18+</Text>
                                        </View>
                                    )}
                                </View>

                                <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={1}>
                                    {item.name}
                                </Text>
                                <Text style={[styles.cardDescription, { color: theme.colors.textSecondary }]} numberOfLines={3}>
                                    {item.description}
                                </Text>
                                <Text style={[styles.cardPersonality, { color: theme.colors.textMuted }]} numberOfLines={3}>
                                    {item.personality}
                                </Text>

                                <View style={styles.tagsRow}>
                                    {item.tags.slice(0, 2).map((tag) => (
                                        <View
                                            key={`${item.id}-${tag}`}
                                            style={[styles.tag, { backgroundColor: theme.colors.primary + '14' }]}
                                        >
                                            <Text style={[styles.tagText, { color: theme.colors.primary }]}>{tag}</Text>
                                        </View>
                                    ))}
                                </View>
                            </TouchableOpacity>
                        )}
                    />
                )}
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        gap: spacing.md,
    },
    headerCopy: { flex: 1 },
    title: { fontSize: fontSize.xxl, fontWeight: '700' },
    subtitle: { marginTop: spacing.xs, fontSize: fontSize.sm, lineHeight: 20 },
    adultToggle: {
        borderWidth: 1,
        borderRadius: borderRadius.full,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    adultToggleText: { fontSize: fontSize.sm, fontWeight: '700' },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginHorizontal: spacing.lg,
        marginBottom: spacing.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
    },
    searchInput: {
        flex: 1,
        fontSize: fontSize.sm,
        paddingVertical: 0,
    },
    listContent: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.xl,
    },
    card: {
        flex: 1,
        margin: spacing.xs,
        borderRadius: borderRadius.xl,
        borderWidth: 1,
        padding: spacing.md,
        minHeight: 250,
    },
    cardTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.md,
    },
    avatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
    },
    badge: {
        backgroundColor: '#ef4444',
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: borderRadius.full,
    },
    badgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    cardTitle: {
        fontSize: fontSize.lg,
        fontWeight: '700',
        marginBottom: spacing.xs,
    },
    cardDescription: {
        fontSize: fontSize.sm,
        lineHeight: 20,
        marginBottom: spacing.sm,
    },
    cardPersonality: {
        fontSize: fontSize.xs,
        lineHeight: 18,
        marginBottom: spacing.md,
    },
    tagsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginTop: 'auto',
    },
    tag: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: borderRadius.full,
    },
    tagText: {
        fontSize: 10,
        fontWeight: '600',
    },
    centerState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
        gap: spacing.sm,
    },
    stateTitle: {
        fontSize: fontSize.lg,
        fontWeight: '700',
    },
    stateText: {
        fontSize: fontSize.sm,
        textAlign: 'center',
        lineHeight: 20,
    },
});
