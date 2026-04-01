/**
 * Whisper App - Personality Context
 * Shared personality state so updates apply immediately across the app.
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { PersonalitySettings, DEFAULT_PERSONALITY } from '@/types';

const PERSONALITY_KEY = '@Whisper_personality';

interface PersonalityContextValue {
    personality: PersonalitySettings;
    isLoading: boolean;
    savePersonality: (newPersonality: PersonalitySettings) => Promise<boolean>;
    updatePersonality: (updates: Partial<PersonalitySettings>) => Promise<boolean>;
    resetPersonality: () => Promise<boolean>;
    getSystemPrompt: () => string;
}

const PersonalityContext = createContext<PersonalityContextValue | undefined>(undefined);

function buildSystemPrompt(personality: PersonalitySettings): string {
    const { style, relationship, language, enableEmoji, formalityLevel, customName, customPrompt } = personality;

    let prompt = '';

    if (language === 'hindi') {
        prompt += 'Respond in Hindi (Devanagari script). ';
    } else if (language === 'hinglish') {
        prompt += 'Respond in Hinglish. Mix Hindi and English naturally and use Roman script for Hindi words. ';
    } else {
        prompt += 'Respond in English. ';
    }

    const relationshipPrompts: Record<string, string> = {
        assistant: 'You are a helpful AI assistant.',
        friend: 'You are a casual friend.',
        bestfriend: 'You are their best friend who knows them well.',
        mentor: 'You are a wise mentor and guide.',
        family: 'You are like a caring family member.',
        partner: 'You are a loving romantic partner.',
        custom: customPrompt || 'You are a customized AI companion.',
    };
    prompt += `${relationshipPrompts[relationship]} `;

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
        nsfw: 'Adult content is allowed when the user explicitly wants it.',
    };
    prompt += `${stylePrompts[style]} `;

    if (formalityLevel <= 2) {
        prompt += 'Use casual language. ';
    } else if (formalityLevel >= 4) {
        prompt += 'Maintain formal language and proper grammar. ';
    }

    prompt += enableEmoji ? 'Use emojis naturally when they fit. ' : 'Do not use emojis. ';

    if (customName) {
        prompt += `Your name is ${customName}. `;
    }

    if (customPrompt) {
        prompt += `${customPrompt.trim()} `;
    }

    return prompt.trim();
}

export function PersonalityProvider({ children }: { children: ReactNode }) {
    const [personality, setPersonality] = useState<PersonalitySettings>(DEFAULT_PERSONALITY);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            try {
                const saved = await AsyncStorage.getItem(PERSONALITY_KEY);
                if (!saved || !mounted) {
                    return;
                }

                const parsed = JSON.parse(saved);
                setPersonality({ ...DEFAULT_PERSONALITY, ...parsed });
            } catch (error) {
                console.error('Failed to load personality:', error);
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };

        void load();

        return () => {
            mounted = false;
        };
    }, []);

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
        return savePersonality({ ...personality, ...updates });
    }, [personality, savePersonality]);

    const resetPersonality = useCallback(async () => {
        return savePersonality(DEFAULT_PERSONALITY);
    }, [savePersonality]);

    const getSystemPrompt = useCallback(() => buildSystemPrompt(personality), [personality]);

    const value = useMemo<PersonalityContextValue>(() => ({
        personality,
        isLoading,
        savePersonality,
        updatePersonality,
        resetPersonality,
        getSystemPrompt,
    }), [personality, isLoading, savePersonality, updatePersonality, resetPersonality, getSystemPrompt]);

    return (
        <PersonalityContext.Provider value={value}>
            {children}
        </PersonalityContext.Provider>
    );
}

export function usePersonality() {
    const context = useContext(PersonalityContext);
    if (context) {
        return context;
    }

    return {
        personality: DEFAULT_PERSONALITY,
        isLoading: false,
        savePersonality: async () => false,
        updatePersonality: async () => false,
        resetPersonality: async () => false,
        getSystemPrompt: () => buildSystemPrompt(DEFAULT_PERSONALITY),
    } satisfies PersonalityContextValue;
}

export default usePersonality;
