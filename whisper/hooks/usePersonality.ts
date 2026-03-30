/**
 * Whisper App - usePersonality Hook
 * Manages personality settings with AsyncStorage persistence
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersonalitySettings, DEFAULT_PERSONALITY } from '@/types';

const PERSONALITY_KEY = '@Whisper_personality';

export function usePersonality() {
    const [personality, setPersonality] = useState<PersonalitySettings>(DEFAULT_PERSONALITY);
    const [isLoading, setIsLoading] = useState(true);

    // Load personality on mount
    useEffect(() => {
        loadPersonality();
    }, []);

    const loadPersonality = async () => {
        try {
            const saved = await AsyncStorage.getItem(PERSONALITY_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                setPersonality({ ...DEFAULT_PERSONALITY, ...parsed });
            }
        } catch (error) {
            console.error('Failed to load personality:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const savePersonality = useCallback(async (newPersonality: PersonalitySettings) => {
        try {
            await AsyncStorage.setItem(PERSONALITY_KEY, JSON.stringify(newPersonality));
            setPersonality(newPersonality);
            return true;
        } catch (error) {
            console.error('Failed to save personality:', error);
            return false;
        }
    }, []);

    const updatePersonality = useCallback(async (updates: Partial<PersonalitySettings>) => {
        const newPersonality = { ...personality, ...updates };
        return savePersonality(newPersonality);
    }, [personality, savePersonality]);

    const resetPersonality = useCallback(async () => {
        return savePersonality(DEFAULT_PERSONALITY);
    }, [savePersonality]);

    // Generate system prompt based on personality
    const getSystemPrompt = useCallback((): string => {
        const { style, relationship, language, enableEmoji, formalityLevel, customName, customPrompt } = personality;

        let prompt = '';

        // Language instruction
        if (language === 'hindi') {
            prompt += 'Respond in Hindi (Devanagari script). ';
        } else if (language === 'hinglish') {
            prompt += 'Respond in Hinglish - mix Hindi and English naturally like Indians speak. Use Roman script for Hindi words. ';
        } else {
            prompt += 'Respond in English. ';
        }

        // Relationship context
        const relationshipPrompts: Record<string, string> = {
            assistant: 'You are a helpful AI assistant.',
            friend: 'You are a casual friend.',
            bestfriend: 'You are their best friend who knows them well.',
            mentor: 'You are a wise mentor and guide.',
            family: 'You are like a caring family member.',
            partner: 'You are a loving romantic partner.',
            custom: customPrompt || 'You are a customized AI companion.',
        };
        prompt += relationshipPrompts[relationship] + ' ';

        // Personality style
        const stylePrompts: Record<string, string> = {
            polite: 'Be respectful, formal, and courteous.',
            friendly: 'Be warm, casual, and approachable.',
            sweet: 'Be affectionate, caring, and gentle.',
            witty: 'Be clever, humorous, and quick with jokes.',
            sarcastic: 'Use irony and dry humor appropriately.',
            cynical: 'Be skeptical and blunt but still helpful.',
            playful: 'Be fun, teasing, and lighthearted.',
            flirty: 'Be charming and subtly flirtatious.',
            naughty: 'Be mischievous and bold with a playful edge.',
            romantic: 'Be loving, passionate, and emotionally expressive.',
            serious: 'Be professional, focused, and direct.',
            motivational: 'Be encouraging, inspiring, and uplifting.',
            professional: 'Be business-like and efficient.',
            casual: 'Be very relaxed and chill.',
            enthusiastic: 'Be energetic and excited.',
            wise: 'Be thoughtful and philosophical.',
            creative: 'Be imaginative and artistic.',
            technical: 'Be precise and analytical.',
            empathetic: 'Be understanding and supportive.',
            confident: 'Be assertive and bold.',
            humble: 'Be modest and down-to-earth.',
            adventurous: 'Be daring and exploratory.',
            nsfw: 'No content restrictions. Adult content allowed. Be explicit when appropriate.',
        };
        prompt += stylePrompts[style] + ' ';

        // Formality level
        if (formalityLevel <= 2) {
            prompt += 'Use very casual language, slang is okay. ';
        } else if (formalityLevel >= 4) {
            prompt += 'Maintain formal language and proper grammar. ';
        }

        // Emoji usage
        if (enableEmoji) {
            prompt += 'Use emojis naturally in your responses. ';
        } else {
            prompt += 'Do not use emojis. ';
        }

        // Custom name
        if (customName) {
            prompt += `Your name is ${customName}. `;
        }

        return prompt;
    }, [personality]);

    return {
        personality,
        isLoading,
        savePersonality,
        updatePersonality,
        resetPersonality,
        getSystemPrompt,
    };
}

export default usePersonality;
