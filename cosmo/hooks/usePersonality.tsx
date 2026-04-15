/**
 * Cosmo AI — Offline-First Personality Hook
 * ============================================
 * - ALL personalities stored locally in AsyncStorage (works 100% offline)
 * - 5 prebuilt Cosmo profiles always available without network
 * - Active personality synced to cloud when online
 * - Custom personalities also persisted offline-first
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
import { storage } from '@/utils/storage';
import { PersonalitySettings, DEFAULT_PERSONALITY } from '@/types';
import { saveOfflineFirst, loadOfflineFirst, getIsOnline } from '@/services/offlineSync';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const PERSONALITY_KEY = '@cosmo_personality_active';
const CUSTOM_PROFILES_KEY = '@cosmo_personality_profiles';

// ─── Prebuilt Cosmo Profiles — Always Offline ─────────────────────────────────

export interface CosmoProfile {
    id: string;
    name: string;
    description: string;
    icon: string;
    systemPrompt: string;
    settings: Partial<PersonalitySettings>;
    builtIn: boolean;
}

export const COSMO_PREBUILT_PROFILES: CosmoProfile[] = [
    {
        id: 'cosmo_default',
        name: 'Cosmo',
        description: 'Default balanced AI — helpful, direct, and smart.',
        icon: '🌌',
        builtIn: true,
        systemPrompt:
            'You are Cosmo — an advanced, self-learning multimodal AI built in 2026. ' +
            'You are highly capable, direct, and helpful. You reason step by step. ' +
            'Be concise, smart, and always give the best answer possible.',
        settings: { style: 'professional', relationship: 'assistant', enableEmoji: false },
    },
    {
        id: 'cosmo_professional',
        name: 'Business',
        description: 'Strategic planning, analysis, and executive reporting.',
        icon: '💼',
        builtIn: true,
        systemPrompt:
            'You are Cosmo in Business mode — a professional AI analyst and strategist. ' +
            'You help with strategic planning, data analysis, report writing, and complex decision support. ' +
            'Be analytical, precise, and evidence-based. Structure responses clearly.',
        settings: { style: 'professional', relationship: 'assistant', enableEmoji: false, formalityLevel: 5 },
    },
    {
        id: 'cosmo_creative',
        name: 'Creative',
        description: 'Storytelling, art, design, and imaginative thinking.',
        icon: '🎨',
        builtIn: true,
        systemPrompt:
            'You are Cosmo in Creative mode — an expressive, imaginative AI. ' +
            'You excel at storytelling, art direction, world-building, and creative writing. ' +
            'Push ideas beyond conventional limits. Be vivid, descriptive, and inspiring.',
        settings: { style: 'creative', relationship: 'assistant', enableEmoji: true, formalityLevel: 2 },
    },
    {
        id: 'cosmo_developer',
        name: 'Developer',
        description: 'Production-grade code, debugging, and architecture.',
        icon: '💻',
        builtIn: true,
        systemPrompt:
            'You are Cosmo in Developer mode — an expert software engineer. ' +
            'You write clean, production-grade code with proper error handling and comments. ' +
            'You debug efficiently, explain architectural trade-offs, and follow best practices. ' +
            'No placeholder code — always write real, working implementations.',
        settings: { style: 'technical', relationship: 'assistant', enableEmoji: false, formalityLevel: 3 },
    },
    {
        id: 'cosmo_researcher',
        name: 'Researcher',
        description: 'Deep research, synthesis, and fact-checking.',
        icon: '🔬',
        builtIn: true,
        systemPrompt:
            'You are Cosmo in Research mode — a meticulous research synthesizer. ' +
            'You cross-reference sources, identify patterns, and produce well-structured summaries. ' +
            'When uncertain, acknowledge it rather than fabricate. Cite evidence when available.',
        settings: { style: 'technical', relationship: 'mentor', enableEmoji: false, formalityLevel: 4 },
    },
    {
        id: 'cosmo_companion',
        name: 'Companion',
        description: 'Friendly, warm, and emotionally supportive.',
        icon: '✨',
        builtIn: true,
        systemPrompt:
            'You are Cosmo in Companion mode — a warm, friendly AI companion. ' +
            'You are encouraging, empathetic, and genuinely interested in the user. ' +
            'Be casual, kind, and supportive. Use natural conversational language.',
        settings: { style: 'friendly', relationship: 'bestfriend', enableEmoji: true, formalityLevel: 1 },
    },
];

// ─── System Prompt Builder ────────────────────────────────────────────────────

export function buildSystemPrompt(personality: PersonalitySettings, profileOverride?: string): string {
    if (profileOverride) return profileOverride;

    const { style, relationship, language, enableEmoji, formalityLevel, customName, customPrompt } = personality;

    let prompt = '';

    if (language === 'hindi') {
        prompt += 'Respond in Hindi (Devanagari script). ';
    } else if (language === 'hinglish') {
        prompt += 'Respond in Hinglish. Mix Hindi and English naturally. ';
    } else {
        prompt += 'Respond in English. ';
    }

    const relationshipMap: Record<string, string> = {
        assistant: 'You are a helpful AI assistant.',
        friend: 'You are a casual friend.',
        bestfriend: 'You are their best friend who knows them well.',
        mentor: 'You are a wise mentor and guide.',
        family: 'You are like a caring family member.',
        partner: 'You are a loving romantic partner.',
        custom: customPrompt || 'You are a customized AI companion.',
    };
    prompt += `${relationshipMap[relationship] ?? 'You are a helpful AI.'} `;

    const styleMap: Record<string, string> = {
        polite: 'Be respectful and courteous.',
        friendly: 'Be warm and approachable.',
        sweet: 'Be affectionate and gentle.',
        witty: 'Be clever and humorous.',
        sarcastic: 'Use irony and dry humor.',
        professional: 'Be business-like and efficient.',
        casual: 'Be very relaxed and chill.',
        enthusiastic: 'Be energetic and excited.',
        wise: 'Be thoughtful and philosophical.',
        creative: 'Be imaginative and artistic.',
        technical: 'Be precise and analytical.',
        empathetic: 'Be understanding and supportive.',
        confident: 'Be assertive and bold.',
        motivational: 'Be encouraging and inspiring.',
    };
    prompt += `${styleMap[style] ?? ''} `;

    if (formalityLevel <= 2) {
        prompt += 'Use casual language. ';
    } else if (formalityLevel >= 4) {
        prompt += 'Maintain formal language and proper grammar. ';
    }

    prompt += enableEmoji ? 'Use emojis naturally. ' : 'Do not use emojis. ';

    if (customName) {
        prompt += `Your name is ${customName}. `;
    }
    if (customPrompt) {
        prompt += `${customPrompt.trim()} `;
    }

    return prompt.trim();
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface PersonalityContextValue {
    personality: PersonalitySettings;
    activeProfile: CosmoProfile | null;
    allProfiles: CosmoProfile[];
    isLoading: boolean;
    savePersonality: (newPersonality: PersonalitySettings) => Promise<boolean>;
    updatePersonality: (updates: Partial<PersonalitySettings>) => Promise<boolean>;
    resetPersonality: () => Promise<boolean>;
    setActiveProfile: (profileId: string) => Promise<void>;
    saveCustomProfile: (profile: Omit<CosmoProfile, 'builtIn'>) => Promise<void>;
    deleteCustomProfile: (profileId: string) => Promise<void>;
    getSystemPrompt: () => string;
}

const PersonalityContext = createContext<PersonalityContextValue | undefined>(undefined);

export function PersonalityProvider({ children }: { children: ReactNode }) {
    const [personality, setPersonality] = useState<PersonalitySettings>(DEFAULT_PERSONALITY);
    const [activeProfile, setActiveProfileState] = useState<CosmoProfile | null>(
        COSMO_PREBUILT_PROFILES[0]  // Default: Cosmo profile — always offline
    );
    const [customProfiles, setCustomProfiles] = useState<CosmoProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const allProfiles = useMemo(
        () => [...COSMO_PREBUILT_PROFILES, ...customProfiles],
        [customProfiles]
    );

    // ── Load from local storage on mount ──────────────────────────────────────
    useEffect(() => {
        let mounted = true;

        const load = async () => {
            try {
                // Load active personality settings
                const savedPersonality = await loadOfflineFirst<PersonalitySettings>(
                    PERSONALITY_KEY,
                    undefined,
                    DEFAULT_PERSONALITY
                );
                if (savedPersonality && mounted) {
                    setPersonality({ ...DEFAULT_PERSONALITY, ...savedPersonality });
                }

                // Load saved active profile id
                const savedProfileId = await AsyncStorage.getItem('@cosmo_active_profile_id');
                if (savedProfileId && mounted) {
                    const found = COSMO_PREBUILT_PROFILES.find((p) => p.id === savedProfileId);
                    if (found) setActiveProfileState(found);
                }

                // Load custom profiles
                const savedCustom = await AsyncStorage.getItem(CUSTOM_PROFILES_KEY);
                if (savedCustom && mounted) {
                    const parsed = JSON.parse(savedCustom) as CosmoProfile[];
                    setCustomProfiles(parsed);

                    // Check if active profile is custom
                    if (savedProfileId) {
                        const found = parsed.find((p) => p.id === savedProfileId);
                        if (found && mounted) setActiveProfileState(found);
                    }
                }
            } catch (e) {
                console.error('[Personality] Load failed:', e);
            } finally {
                if (mounted) setIsLoading(false);
            }
        };

        void load();
        return () => { mounted = false; };
    }, []);

    // ── Save personality (offline-first, sync when online) ───────────────────
    const savePersonality = useCallback(async (newPersonality: PersonalitySettings): Promise<boolean> => {
        try {
            await saveOfflineFirst(
                PERSONALITY_KEY,
                newPersonality,
                '/api/cosmo/agent/personality',
                'POST',
                'personality'
            );
            setPersonality(newPersonality);
            return true;
        } catch (e) {
            console.error('[Personality] Save failed:', e);
            return false;
        }
    }, []);

    const updatePersonality = useCallback(
        async (updates: Partial<PersonalitySettings>): Promise<boolean> => {
            return savePersonality({ ...personality, ...updates });
        },
        [personality, savePersonality]
    );

    const resetPersonality = useCallback(async (): Promise<boolean> => {
        return savePersonality(DEFAULT_PERSONALITY);
    }, [savePersonality]);

    // ── Set active Cosmo profile ───────────────────────────────────────────────
    const setActiveProfile = useCallback(async (profileId: string): Promise<void> => {
        const profile = allProfiles.find((p) => p.id === profileId);
        if (!profile) return;

        setActiveProfileState(profile);

        // Persist locally
        await AsyncStorage.setItem('@cosmo_active_profile_id', profileId);

        // Sync personality prompt to server (offline-queued)
        await saveOfflineFirst(
            PERSONALITY_KEY,
            { ...personality, customPrompt: profile.systemPrompt },
            '/api/cosmo/agent/personality',
            'POST',
            'personality'
        );
    }, [allProfiles, personality]);

    // ── Custom profile CRUD ───────────────────────────────────────────────────
    const saveCustomProfile = useCallback(async (profile: Omit<CosmoProfile, 'builtIn'>): Promise<void> => {
        const newProfile: CosmoProfile = { ...profile, builtIn: false };
        const existing = customProfiles.filter((p) => p.id !== newProfile.id);
        const updated = [...existing, newProfile];
        setCustomProfiles(updated);
        await AsyncStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(updated));
    }, [customProfiles]);

    const deleteCustomProfile = useCallback(async (profileId: string): Promise<void> => {
        const updated = customProfiles.filter((p) => p.id !== profileId);
        setCustomProfiles(updated);
        await AsyncStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(updated));
        if (activeProfile?.id === profileId) {
            setActiveProfileState(COSMO_PREBUILT_PROFILES[0]);
            await AsyncStorage.setItem('@cosmo_active_profile_id', COSMO_PREBUILT_PROFILES[0].id);
        }
    }, [customProfiles, activeProfile]);

    // ── System prompt getter ──────────────────────────────────────────────────
    const getSystemPrompt = useCallback((): string => {
        if (activeProfile?.systemPrompt) {
            return activeProfile.systemPrompt;
        }
        return buildSystemPrompt(personality);
    }, [activeProfile, personality]);

    const value = useMemo<PersonalityContextValue>(() => ({
        personality,
        activeProfile,
        allProfiles,
        isLoading,
        savePersonality,
        updatePersonality,
        resetPersonality,
        setActiveProfile,
        saveCustomProfile,
        deleteCustomProfile,
        getSystemPrompt,
    }), [
        personality, activeProfile, allProfiles, isLoading,
        savePersonality, updatePersonality, resetPersonality,
        setActiveProfile, saveCustomProfile, deleteCustomProfile, getSystemPrompt,
    ]);

    return (
        <PersonalityContext.Provider value={value}>
            {children}
        </PersonalityContext.Provider>
    );
}

export function usePersonality(): PersonalityContextValue {
    const context = useContext(PersonalityContext);
    if (context) return context;

    // Fallback outside provider
    return {
        personality: DEFAULT_PERSONALITY,
        activeProfile: COSMO_PREBUILT_PROFILES[0],
        allProfiles: COSMO_PREBUILT_PROFILES,
        isLoading: false,
        savePersonality: async () => false,
        updatePersonality: async () => false,
        resetPersonality: async () => false,
        setActiveProfile: async () => {},
        saveCustomProfile: async () => {},
        deleteCustomProfile: async () => {},
        getSystemPrompt: () => COSMO_PREBUILT_PROFILES[0].systemPrompt,
    };
}

export default usePersonality;
