/**
 * Character Avatar Mappings
 * Uses DiceBear API for consistent, high-quality avatars
 */

export interface CharacterAvatarConfig {
  id: string;
  name: string;
  avatarUrl: string;
  backgroundColor?: string;
}

// DiceBear avatar configurations for each character
export const characterAvatars: CharacterAvatarConfig[] = [
  {
    id: 'romantic_partner',
    name: 'Romantic Partner',
    avatarUrl: 'https://api.dicebear.com/9.x/adventurer/png?seed=romantic&backgroundColor=ff6b9d',
  },
  {
    id: 'friendly_assistant',
    name: 'Friendly Assistant',
    avatarUrl: 'https://api.dicebear.com/9.x/avataaars/png?seed=assistant&backgroundColor=4dabf7',
  },
{
    id: 'expert_advisor',
    name: 'Expert Advisor',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts/png?seed=advisor&backgroundColor=748ffc',
  },
  {
    id: 'creative_partner',
    name: 'Creative Partner',
    avatarUrl: 'https://api.dicebear.com/9.x/lorelei/png?seed=creative&backgroundColor=ffd43b',
  },
  {
    id: 'supportive_therapist',
    name: 'Supportive Therapist',
    avatarUrl: 'https://api.dicebear.com/9.x/notionists/png?seed=therapist&backgroundColor=51cf66',
  },
  {
    id: 'anime_waifu',
    name: 'Anime Waifu',
    avatarUrl: 'https://api.dicebear.com/9.x/big-smile/png?seed=waifu&backgroundColor=ff8787',
  },
  {
    id: 'dominant_master',
    name: 'Dominant Master',
    avatarUrl: 'https://api.dicebear.com/9.x/adventurer-neutral/png?seed=dominant&backgroundColor=212529',
  },
  {
    id: 'submissive_companion',
    name: 'Submissive Companion',
    avatarUrl: 'https://api.dicebear.com/9.x/micah/png?seed=submissive&backgroundColor=ffc9c9',
  },
  {
    id: 'flirty_friend',
    name: 'Flirty Friend',
    avatarUrl: 'https://api.dicebear.com/9.x/lorelei-neutral/png?seed=flirty&backgroundColor=ff6b9d',
  },
  {
    id: 'professional_mentor',
    name: 'Professional Mentor',
    avatarUrl: 'https://api.dicebear.com/9.x/personas/png?seed=mentor&backgroundColor=495057',
  },
  {
    id: 'fitness_coach',
    name: 'Fitness Coach',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/png?seed=fitness&backgroundColor=ff922b',
  },
  {
    id: 'gaming_buddy',
    name: 'Gaming Buddy',
    avatarUrl: 'https://api.dicebear.com/9.x/pixel-art/png?seed=gaming&backgroundColor=9775fa',
  },
];

/**
 * Get avatar URL for a character
 */
export function getCharacterAvatar(characterId: string): string {
  const character = characterAvatars.find(c => c.id === characterId);
  return character?.avatarUrl || `https://api.dicebear.com/9.x/avataaars/png?seed=${characterId}`;
}

/**
 * Get all character avatars
 */
export function getAllCharacterAvatars(): CharacterAvatarConfig[] {
  return characterAvatars;
}
