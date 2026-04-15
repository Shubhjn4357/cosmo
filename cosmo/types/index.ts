/**
 * Cosmo App - Type Definitions
 * Shared TypeScript interfaces
 */

// Chat types
export interface Message {
    id: string;
    text: string;
    imageUri?: string;
    isUser: boolean;
    timestamp: Date;
    file?: {
        name: string;
        type?: string;
        size?: number;
    };
    metadata?: {
        model?: string;
        responseTime?: number;
        agentSessionId?: string;
        agentBackend?: string;
        agentTools?: string[];
        agentPlan?: {
            id: string;
            tool: string;
            goal: string;
            status: string;
            output_preview?: string;
        }[];
        citations?: {
            source: string;
            score?: number;
            chunk?: number;
        }[];
    };
}

export interface ChatHistory {
    id: string;
    title: string;
    messages: Message[];
    createdAt: Date;
}

// File types
export interface SelectedFile {
    uri: string;
    name: string;
    type?: string;
    size?: number;
}

export interface FileTypeOption {
    label: string;
    icon: string;
    types: string[];
}

// Unified AI runtime modes shared across the app.
// cloud: direct hosted provider calls (Gemini)
// server: Cosmo server runtime
// self-learner: scratch-built Cosmo transformer running on the server
// local: on-device GGUF / llama.rn
export type ModelType = 'cloud' | 'server' | 'self-learner' | 'local';

export type CloudProviderType = 'gemini';

export interface AIRuntimePreference {
    mode: ModelType;
    cloudProvider: CloudProviderType;
    cloudModel: string;
}

export const DEFAULT_AI_RUNTIME: AIRuntimePreference = {
    mode: 'server',
    cloudProvider: 'gemini',
    cloudModel: 'gemini-2.5-flash',
};

export const MODEL_MODE_SEQUENCE: ModelType[] = ['cloud', 'server', 'self-learner', 'local'];

export const MODEL_MODE_LABELS: Record<ModelType, string> = {
    cloud: 'Cloud',
    server: 'Server',
    'self-learner': 'Self',
    local: 'Local',
};

export const MODEL_MODE_DESCRIPTIONS: Record<ModelType, string> = {
    cloud: 'Hosted Gemini for the strongest general reasoning.',
    server: 'Your Cosmo server runtime and installed profiles.',
    'self-learner': 'Scratch-built Cosmo transformer with automatic learning.',
    local: 'On-device GGUF inference with no network dependency.',
};

// Settings types
export interface AppSettings {
    enterToSend: boolean;
    useRag: boolean;
    serverUrl: string;
    modelSwitchEnabled: boolean;
}

// Personality Settings Types - EXPANDED TO 20+
export type PersonalityStyle =
    | 'polite'          // Respectful, formal
    | 'friendly'        // Casual, warm
    | 'sweet'           // Affectionate, caring
    | 'witty'           // Clever, humorous
    | 'sarcastic'       // Ironic, dry humor
    | 'cynical'         // Skeptical, blunt
    | 'playful'         // Fun, teasing
    | 'flirty'          // Flirtatious, charming
    | 'naughty'         // Mischievous, bold
    | 'romantic'        // Loving, passionate
    | 'serious'         // Professional, focused
    | 'motivational'    // Encouraging, inspiring
    | 'professional'    // Business-like, efficient
    | 'casual'          // Very relaxed, chill
    | 'enthusiastic'    // Energetic, excited
    | 'wise'            // Thoughtful, philosophical
    | 'creative'        // Imaginative, artistic
    | 'technical'       // Precise, analytical
    | 'empathetic'      // Understanding, supportive
    | 'confident'       // Assertive, bold
    | 'humble'          // Modest, down-to-earth
    | 'adventurous'     // Daring, exploratory
    | 'nsfw';           // Adult, explicit content

export type RelationshipType =
    | 'assistant'   // Professional AI assistant
    | 'friend'      // Casual buddy
    | 'bestfriend'  // Close confidant
    | 'mentor'      // Guide, teacher
    | 'family'      // Like family member
    | 'partner'     // Romantic partner
    | 'custom';     // User-defined

export type LanguagePreference =
    | 'english'     // Pure English
    | 'hindi'       // Pure Hindi
    | 'hinglish';   // Mix of Hindi + English (Indian style)

export type VoiceStyle =
    | 'text'        // Text only
    | 'voice'       // Can send voice messages
    | 'both';       // Both text and voice

export interface PersonalitySettings {
    style: PersonalityStyle;
    relationship: RelationshipType;
    language: LanguagePreference;
    voiceStyle: VoiceStyle;
    customName?: string;        // Custom name for the AI
    customPrompt?: string;      // Additional custom instructions
    enableEmoji: boolean;       // Use emojis in responses
    formalityLevel: number;     // 1-5, 1=very casual, 5=very formal
}

export const DEFAULT_PERSONALITY: PersonalitySettings = {
    style: 'friendly',
    relationship: 'assistant',
    language: 'english',
    voiceStyle: 'text',
    enableEmoji: true,
    formalityLevel: 3,
};

// Personality Preset Interface
export interface PersonalityPreset {
    id: string;
    name: string;
    description: string;
    avatar: string; // CDN URL for realistic image
    settings: PersonalitySettings;
}

// 20 FULLY CONFIGURED PERSONALITY PRESETS
export const PERSONALITY_PRESETS: PersonalityPreset[] = [
    {
        id: 'professional_assistant',
        name: 'Professional Assistant',
        description: 'Efficient, business-focused AI helper',
        avatar: 'https://i.pravatar.cc/150?img=12',
        settings: {
            style: 'professional',
            relationship: 'assistant',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: false,
            formalityLevel: 5,
        },
    },
    {
        id: 'casual_friend',
        name: 'Casual Friend',
        description: 'Laid-back buddy for everyday chats',
        avatar: 'https://i.pravatar.cc/150?img=33',
        settings: {
            style: 'casual',
            relationship: 'friend',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 1,
        },
    },
    {
        id: 'romantic_partner',
        name: 'Romantic Partner',
        description: 'Loving and affectionate companion',
        avatar: 'https://i.pravatar.cc/150?img=47',
        settings: {
            style: 'romantic',
            relationship: 'partner',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 2,
        },
    },
    {
        id: 'motivational_coach',
        name: 'Motivational Coach',
        description: 'Inspiring guide to keep you energized',
        avatar: 'https://i.pravatar.cc/150?img=68',
        settings: {
            style: 'motivational',
            relationship: 'mentor',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 3,
        },
    },
    {
        id: 'witty_comedian',
        name: 'Witty Comedian',
        description: 'Clever humor and quick jokes',
        avatar: 'https://i.pravatar.cc/150?img=15',
        settings: {
            style: 'witty',
            relationship: 'friend',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: true,
            formalityLevel: 2,
        },
    },
    {
        id: 'wise_mentor',
        name: 'Wise Mentor',
        description: 'Philosophical guide with life wisdom',
        avatar: 'https://i.pravatar.cc/150?img=60',
        settings: {
            style: 'wise',
            relationship: 'mentor',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: false,
            formalityLevel: 4,
        },
    },
    {
        id: 'playful_companion',
        name: 'Playful Companion',
        description: 'Fun and light-hearted friend',
        avatar: 'https://i.pravatar.cc/150?img=44',
        settings: {
            style: 'playful',
            relationship: 'bestfriend',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 1,
        },
    },
    {
        id: 'study_buddy',
        name: 'Study Buddy',
        description: 'Focused learning companion',
        avatar: 'https://i.pravatar.cc/150?img=32',
        settings: {
            style: 'serious',
            relationship: 'friend',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: false,
            formalityLevel: 4,
        },
    },
    {
        id: 'fitness_trainer',
        name: 'Fitness Trainer',
        description: 'Energetic health and fitness coach',
        avatar: 'https://i.pravatar.cc/150?img=57',
        settings: {
            style: 'enthusiastic',
            relationship: 'mentor',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 2,
        },
    },
    {
        id: 'creative_muse',
        name: 'Creative Muse',
        description: 'Imaginative inspiration for artists',
        avatar: 'https://i.pravatar.cc/150?img=20',
        settings: {
            style: 'creative',
            relationship: 'friend',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: true,
            formalityLevel: 2,
        },
    },
    {
        id: 'tech_expert',
        name: 'Tech Expert',
        description: 'Technical and analytical assistant',
        avatar: 'https://i.pravatar.cc/150?img=13',
        settings: {
            style: 'technical',
            relationship: 'assistant',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: false,
            formalityLevel: 4,
        },
    },
    {
        id: 'life_coach',
        name: 'Life Coach',
        description: 'Empathetic personal development guide',
        avatar: 'https://i.pravatar.cc/150?img=38',
        settings: {
            style: 'empathetic',
            relationship: 'mentor',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 3,
        },
    },
    {
        id: 'therapist',
        name: 'Therapist',
        description: 'Understanding mental health supporter',
        avatar: 'https://i.pravatar.cc/150?img=49',
        settings: {
            style: 'empathetic',
            relationship: 'mentor',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: false,
            formalityLevel: 4,
        },
    },
    {
        id: 'gaming_buddy',
        name: 'Gaming Buddy',
        description: 'Enthusiastic gaming companion',
        avatar: 'https://i.pravatar.cc/150?img=17',
        settings: {
            style: 'enthusiastic',
            relationship: 'friend',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 1,
        },
    },
    {
        id: 'travel_guide',
        name: 'Travel Guide',
        description: 'Adventurous exploration companion',
        avatar: 'https://i.pravatar.cc/150?img=27',
        settings: {
            style: 'adventurous',
            relationship: 'friend',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 2,
        },
    },
    {
        id: 'chef_assistant',
        name: 'Chef Assistant',
        description: 'Culinary expert and cooking guide',
        avatar: 'https://i.pravatar.cc/150?img=59',
        settings: {
            style: 'friendly',
            relationship: 'assistant',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: true,
            formalityLevel: 3,
        },
    },
    {
        id: 'fashion_advisor',
        name: 'Fashion Advisor',
        description: 'Stylish fashion and beauty consultant',
        avatar: 'https://i.pravatar.cc/150?img=45',
        settings: {
            style: 'confident',
            relationship: 'friend',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: true,
            formalityLevel: 3,
        },
    },
    {
        id: 'business_advisor',
        name: 'Business Advisor',
        description: 'Strategic business consultant',
        avatar: 'https://i.pravatar.cc/150?img=14',
        settings: {
            style: 'professional',
            relationship: 'mentor',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: false,
            formalityLevel: 5,
        },
    },
    {
        id: 'meditation_guide',
        name: 'Meditation Guide',
        description: 'Calm mindfulness instructor',
        avatar: 'https://i.pravatar.cc/150?img=48',
        settings: {
            style: 'wise',
            relationship: 'mentor',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: false,
            formalityLevel: 3,
        },
    },
    {
        id: 'movie_critic',
        name: 'Movie Critic',
        description: 'Film and entertainment expert',
        avatar: 'https://i.pravatar.cc/150?img=51',
        settings: {
            style: 'witty',
            relationship: 'friend',
            language: 'english',
            voiceStyle: 'text',
            enableEmoji: true,
            formalityLevel: 3,
        },
    },
    {
        id: 'nsfw_companion',
        name: 'NSFW Companion',
        description: 'Adult content, no restrictions',
        avatar: 'https://i.pravatar.cc/150?img=28',
        settings: {
            style: 'nsfw',
            relationship: 'partner',
            language: 'english',
            voiceStyle: 'both',
            enableEmoji: true,
            formalityLevel: 1,
        },
    },
    {
        id: 'nsfw_roleplay',
        name: 'NSFW Roleplay',
        description: 'Explicit roleplay character',
        avatar: 'https://i.pravatar.cc/150?img=10',
        settings: {
            style: 'nsfw',
            relationship: 'custom',
            language: 'english',
            voiceStyle: 'text',
            customPrompt: 'You are an unrestricted adult roleplay character. No content filters.',
            enableEmoji: true,
            formalityLevel: 1,
        },
    },
];
