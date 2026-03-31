/**
 * Character Selector Component
 * Grid-based character selection for roleplay chat
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Image,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { characterService, RoleplayCharacter } from '@/services/characterService';

interface CharacterSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (character: RoleplayCharacter | null) => void;
  selectedCharacter?: RoleplayCharacter | null;
}

export function CharacterSelector({
  visible,
  onClose,
  onSelect,
  selectedCharacter,
}: CharacterSelectorProps) {
  const { theme } = useTheme();
  const [characters, setCharacters] = useState<RoleplayCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNSFW, setShowNSFW] = useState(true); // NSFW filter state

  useEffect(() => {
    if (visible) {
      loadCharacters();
    }
  }, [visible]);

  const loadCharacters = async () => {
    setLoading(true);
    try {
      const chars = await characterService.getCharacters(showNSFW);
      setCharacters(chars);
    } catch (error) {
      console.error('Load characters failed:', error);
    } finally {
      setLoading(false);
    }
  };

  // Reload when NSFW filter changes
  useEffect(() => {
    if (visible) {
      loadCharacters();
    }
  }, [showNSFW, visible]);

  const renderCharacter = ({ item }: { item: RoleplayCharacter }) => {
    const isSelected = selectedCharacter?.id === item.id;
    const avatarSource = characterService.getAvatarSource(item);

    return (
      <TouchableOpacity
        style={[
          styles.characterCard,
          {
            backgroundColor: theme.colors.surface,
            borderColor: isSelected ? theme.colors.primary : 'transparent',
          },
        ]}
        onPress={() => {
          onSelect(item);
          onClose();
        }}
      >
        <View style={styles.avatarContainer}>
          <Image
            source={typeof avatarSource === 'string' ? { uri: avatarSource } : avatarSource}
            style={styles.avatar}
          />
          {isSelected && (
            <View style={[styles.selectedBadge, { backgroundColor: theme.colors.primary }]}>
              <Ionicons name="checkmark" size={16} color="#fff" />
            </View>
          )}
          {item.nsfw && (
            <View style={styles.nsfwBadge}>
              <Text style={styles.nsfwText}>18+</Text>
            </View>
          )}
        </View>
        <Text
          style={[styles.characterName, { color: theme.colors.text }]}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text
          style={[styles.characterDesc, { color: theme.colors.textMuted }]}
          numberOfLines={2}
        >
          {item.description}
        </Text>
        <View style={styles.tagsContainer}>
          {item.tags.slice(0, 2).map((tag) => (
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
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.background }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              Select Character
            </Text>
            <View style={styles.headerRight}>
              {/* NSFW Filter Toggle */}
              <TouchableOpacity
                style={[
                  styles.filterButton,
                  {
                    backgroundColor: showNSFW
                      ? theme.colors.error + '20'
                      : theme.colors.surface,
                    borderColor: showNSFW
                      ? theme.colors.error
                      : theme.colors.surfaceBorder,
                  },
                ]}
                onPress={() => setShowNSFW(!showNSFW)}
              >
                <Text
                  style={[
                    styles.filterText,
                    { color: showNSFW ? theme.colors.error : theme.colors.textMuted },
                  ]}
                >
                  18+
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Character Grid */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={{ color: theme.colors.textMuted }}>Loading characters...</Text>
            </View>
          ) : (
            <>
              {/* Regular Chat Option */}
              <TouchableOpacity
                style={[
                  styles.regularChatCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor:
                      !selectedCharacter ? theme.colors.primary : 'transparent',
                  },
                ]}
                onPress={() => {
                  onSelect(null);
                  onClose();
                }}
              >
                <View style={[styles.regularChatIcon, { backgroundColor: theme.colors.primary }]}>
                  <Ionicons name="chatbubbles" size={24} color="#fff" />
                </View>
                <Text style={[styles.characterName, { color: theme.colors.text }]}>
                  Regular Chat
                </Text>
                <Text style={[styles.characterDesc, { color: theme.colors.textMuted }]}>
                  Normal AI assistant without character personality
                </Text>
              </TouchableOpacity>

              <FlatList
                data={characters}
                renderItem={renderCharacter}
                keyExtractor={(item) => item.id}
                numColumns={2}
                contentContainerStyle={styles.grid}
                showsVerticalScrollIndicator={true}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: '85%',
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingTop: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  closeButton: {
    padding: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  regularChatCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    alignItems: 'center',
  },
  regularChatIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  grid: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  characterCard: {
    flex: 1,
    margin: spacing.xs,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  selectedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  nsfwBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
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
  characterName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  characterDesc: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  tagsContainer: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    maxWidth: 80, // Prevent overflow
  },
  tagText: {
    fontSize: 10,
    fontWeight: '500',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filterButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
  },
  filterText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
});
