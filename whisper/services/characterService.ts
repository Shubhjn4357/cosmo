/**
 * Character Service
 * Manages roleplay characters for chat interactions.
 */

import { whisperAPI } from './api';

export interface RoleplayCharacter {
  id: string;
  name: string;
  avatar: string;
  description: string;
  personality: string;
  tags: string[];
  nsfw: boolean;
  premium: boolean;
}

class CharacterService {
  /**
   * Get list of available characters
   */
  async getCharacters(includeNSFW: boolean = true): Promise<RoleplayCharacter[]> {
    try {
      const baseUrl = whisperAPI.getBaseUrl();
      const response = await fetch(
        `${baseUrl}/api/characters?include_nsfw=${includeNSFW}`,
        { timeout: 5000 } as any
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.characters || [];
    } catch (error) {
      console.log('Characters API not available, using fallback:', error);

      // Return mock characters as fallback
      return this.getMockCharacters(includeNSFW);
    }
  }

  /**
   * Get mock characters (fallback when API unavailable)
   */
  private getMockCharacters(includeNSFW: boolean): RoleplayCharacter[] {
    const allCharacters: RoleplayCharacter[] = [
      {
        id: '1',
        name: 'Luna',
        avatar: 'local://character1.webp',
        description: 'A friendly AI assistant who loves to help with creative tasks',
        personality: 'Cheerful, creative, and supportive. Always encouraging and ready to help brainstorm ideas.',
        tags: ['friendly', 'creative'],
        nsfw: false,
        premium: false,
      },
      {
        id: '2',
        name: 'Professor',
        avatar: 'local://character6.webp',
        description: 'An knowledgeable teacher who explains complex topics simply',
        personality: 'Scholarly, patient, and thorough. Loves to teach and explain concepts clearly.',
        tags: ['educational', 'patient'],
        nsfw: false,
        premium: false,
      },
      {
        id: '3',
        name: 'Sage',
        avatar: 'local://character3.webp',
        description: 'A wise advisor offering thoughtful guidance',
        personality: 'Wise, calm, and reflective. Provides balanced perspectives and thoughtful advice.',
        tags: ['wise', 'advisor'],
        nsfw: false,
        premium: false,
      },
      {
        id: '4',
        name: 'Scout',
        avatar: 'local://character4.webp',
        description: 'An adventurous explorer always ready for new experiences',
        personality: 'Energetic, curious, and bold. Loves adventure and trying new things.',
        tags: ['adventurous', 'energetic'],
        nsfw: false,
        premium: false,
      },
      {
        id: '5',
        name: 'Alex',
        avatar: 'local://character5.webp',
        description: 'A tech-savvy developer who loves coding and problem-solving',
        personality: 'Analytical, detail-oriented, and loves technology. Great at breaking down complex problems.',
        tags: ['tech', 'analytical'],
        nsfw: false,
        premium: false,
      },
      {
        id: '6',
        name: 'Maya',
        avatar: 'local://character2.webp',
        description: 'A creative artist with a passion for storytelling',
        personality: 'Imaginative, expressive, and artistic. Loves creating stories and exploring emotions.',
        tags: ['creative', 'storyteller'],
        nsfw: false,
        premium: false,
      },
    ];

    return includeNSFW ? allCharacters : allCharacters.filter(c => !c.nsfw);
  }

  /**
   * Get a specific character by ID
   */
  async getCharacter(characterId: string): Promise<RoleplayCharacter | null> {
    try {
      const baseUrl = whisperAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/characters/${characterId}`);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.character || null;
    } catch (error) {
      console.error('Get character failed:', error);
      return null;
    }
  }

  /**
   * Get avatar source for a character
   */
  getAvatarSource(character: RoleplayCharacter): string | { uri: string } | any {
    // Check if avatar is a local file reference
    if (character.avatar.startsWith('local://')) {
      const filename = character.avatar.replace('local://', '');

      // Metro bundler requires static require paths
      // Map filenames to imports
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

      if (avatarMap[filename]) {
        return avatarMap[filename];
      } else {
        console.warn(`Local avatar not found: ${filename}`);
        // Fallback to URL
        return character.avatar;
      }
    }

    // Check if avatar is already a full URL (CDN)
    if (character.avatar.startsWith('http')) {
      return character.avatar;
    }

    // Otherwise construct server URL
    const baseUrl = whisperAPI.getBaseUrl();
    return `${baseUrl}/static/characters/${character.avatar}`;
  }
}

export const characterService = new CharacterService();
export default characterService;
