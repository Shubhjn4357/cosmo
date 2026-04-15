/**
 * Character Service
 * Uses the full local 22-character preset catalog and merges in any server extras.
 */

import { cosmoAPI } from './api';
import { BUILT_IN_CHARACTERS } from './roleplayService';

export interface RoleplayCharacter {
  id: string;
  name: string;
  avatar: string;
  description: string;
  personality: string;
  systemPrompt?: string;
  greeting?: string;
  tags: string[];
  nsfw: boolean;
  premium: boolean;
}

function normalizeBuiltInCharacters(includeNSFW: boolean): RoleplayCharacter[] {
  return BUILT_IN_CHARACTERS
    .filter((character) => includeNSFW || !character.isNSFW)
    .map((character) => ({
      id: character.id,
      name: character.name,
      avatar: character.avatar,
      description: character.description,
      personality: character.tags.join(', '),
      systemPrompt: character.systemPrompt,
      greeting: character.greeting,
      tags: character.tags,
      nsfw: character.isNSFW,
      premium: false,
    }));
}

function normalizeRemoteCharacter(raw: any): RoleplayCharacter {
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? 'Character'),
    avatar: String(raw?.avatar ?? ''),
    description: String(raw?.description ?? ''),
    personality: String(raw?.personality ?? ''),
    systemPrompt: raw?.system_prompt ?? raw?.systemPrompt,
    greeting: raw?.greeting,
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
    nsfw: Boolean(raw?.nsfw ?? raw?.isNSFW),
    premium: Boolean(raw?.premium),
  };
}

class CharacterService {
  private getBuiltInCharacters(includeNSFW: boolean): RoleplayCharacter[] {
    return normalizeBuiltInCharacters(includeNSFW);
  }

  private mergeCharacters(primary: RoleplayCharacter[], secondary: RoleplayCharacter[]) {
    const merged = new Map<string, RoleplayCharacter>();

    primary.forEach((character) => merged.set(character.id, character));
    secondary.forEach((character) => {
      const existing = merged.get(character.id);
      merged.set(character.id, {
        ...character,
        systemPrompt: character.systemPrompt || existing?.systemPrompt,
        greeting: character.greeting || existing?.greeting,
      });
    });

    return Array.from(merged.values());
  }

  /**
   * Get list of available characters.
   * Local presets stay authoritative so roleplay always has the full 22-character set.
   */
  async getCharacters(includeNSFW: boolean = true): Promise<RoleplayCharacter[]> {
    const localCharacters = this.getBuiltInCharacters(includeNSFW);

    try {
      const baseUrl = cosmoAPI.getBaseUrl();
      const response = await fetch(
        `${baseUrl}/api/characters?include_nsfw=${includeNSFW}`,
        { timeout: 5000 } as any
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const remoteCharacters = Array.isArray(data.characters)
        ? data.characters.map(normalizeRemoteCharacter)
        : [];

      return this.mergeCharacters(localCharacters, remoteCharacters);
    } catch (error) {
      console.log('Characters API not available, using local presets:', error);
      return localCharacters;
    }
  }

  /**
   * Get a specific character by ID.
   */
  async getCharacter(characterId: string): Promise<RoleplayCharacter | null> {
    const localCharacters = this.getBuiltInCharacters(true);
    const localMatch = localCharacters.find((character) => character.id === characterId);
    if (localMatch) {
      return localMatch;
    }

    try {
      const baseUrl = cosmoAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/characters/${characterId}`);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.character ? normalizeRemoteCharacter(data.character) : null;
    } catch (error) {
      console.error('Get character failed:', error);
      return null;
    }
  }

  /**
   * Get avatar source for a character.
   */
  getAvatarSource(character: RoleplayCharacter): string | { uri: string } | any {
    if (character.avatar.startsWith('local://')) {
      const filename = character.avatar.replace('local://', '');

      const avatarMap: Record<string, any> = {
        'character1.webp': require('@/assets/characters/images/character1.webp'),
        'character2.webp': require('@/assets/characters/images/character2.webp'),
        'character3.webp': require('@/assets/characters/images/character3.webp'),
        'character4.webp': require('@/assets/characters/images/character4.webp'),
        'character5.webp': require('@/assets/characters/images/character5.webp'),
        'character6.webp': require('@/assets/characters/images/character6.webp'),
        'character7.webp': require('@/assets/characters/images/character7.webp'),
        'character8.webp': require('@/assets/characters/images/character8.webp'),
        'character9.webp': require('@/assets/characters/images/character9.webp'),
        'character10.webp': require('@/assets/characters/images/character10.webp'),
        'character11.webp': require('@/assets/characters/images/character11.webp'),
        'character12.webp': require('@/assets/characters/images/character12.webp'),
        'character13.webp': require('@/assets/characters/images/character13.webp'),
        'character14.webp': require('@/assets/characters/images/character14.webp'),
        'character15.webp': require('@/assets/characters/images/character15.webp'),
        'character16.webp': require('@/assets/characters/images/character16.webp'),
        'character17.webp': require('@/assets/characters/images/character17.webp'),
        'character18.webp': require('@/assets/characters/images/character18.webp'),
        'character19.webp': require('@/assets/characters/images/character19.webp'),
        'character20.webp': require('@/assets/characters/images/character20.webp'),
      };

      return avatarMap[filename] || character.avatar;
    }

    if (character.avatar.startsWith('http')) {
      return character.avatar;
    }

    const baseUrl = cosmoAPI.getBaseUrl();
    return `${baseUrl}/static/characters/${character.avatar}`;
  }
}

export const characterService = new CharacterService();
export default characterService;
