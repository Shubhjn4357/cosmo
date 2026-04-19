// Cosmo AI Shared Type Definitions
// Source: SaaS Application Blueprint (2026 Standard)

/**
 * Auth types
 */
export interface AuthUser {
    id: string;
    email: string | null;
    user_metadata?: {
        full_name?: string;
        avatar_url?: string;
        [key: string]: unknown;
    };
}

export interface UserProfile {
    id: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    consent_given: boolean;
    data_collection_consent: boolean;
    is_admin: boolean;
    created_at: string;
}

export interface AuthSession {
    access_token: string;
    refresh_token: string;
    user: AuthUser;
}

/**
 * Chat & Message types
 */
export interface MessageFile {
    name: string;
    type?: string;
    size?: number;
}

export interface MessageMetadata {
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
}

export interface RawMessage {
    id?: string | number;
    text?: string;
    content?: string;
    imageUri?: string;
    image_url?: string;
    isUser?: boolean;
    role?: 'user' | 'assistant' | 'system';
    timestamp?: string | number | Date;
    file?: MessageFile;
    metadata?: MessageMetadata;
}

export interface Message {
    id: string;
    text: string;
    imageUri?: string;
    isUser: boolean;
    timestamp: Date;
    file?: MessageFile;
    metadata?: MessageMetadata;
}

export interface RawChatHistory {
    id?: string;
    title?: string;
    messages?: RawMessage[];
    model_id?: string | null;
    is_local?: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface ChatHistory {
    id: string;
    title: string;
    messages: Message[];
    createdAt: Date;
    model_id?: string | null;
    updatedAt?: Date;
}

/**
 * Models & Runtime
 */
export type ModelType = 'cloud' | 'server' | 'self-learner' | 'local';
export type CloudProviderType = 'gemini';

export interface AIRuntimePreference {
    mode: ModelType;
    cloudProvider: CloudProviderType;
    cloudModel: string;
}

/**
 * Personality & Roleplay
 */
export type PersonalityStyle =
    | 'polite'
    | 'friendly'
    | 'sweet'
    | 'witty'
    | 'sarcastic'
    | 'cynical'
    | 'playful'
    | 'flirty'
    | 'naughty'
    | 'romantic'
    | 'serious'
    | 'motivational'
    | 'professional'
    | 'casual'
    | 'enthusiastic'
    | 'wise'
    | 'creative'
    | 'technical'
    | 'empathetic'
    | 'confident'
    | 'humble'
    | 'adventurous'
    | 'nsfw';

export type RelationshipType =
    | 'assistant'
    | 'friend'
    | 'bestfriend'
    | 'mentor'
    | 'family'
    | 'partner'
    | 'custom';

export type LanguagePreference =
    | 'english'
    | 'hindi'
    | 'hinglish';

export type VoiceStyle =
    | 'text'
    | 'voice'
    | 'both';

export interface PersonalitySettings {
    style: PersonalityStyle;
    relationship: RelationshipType;
    language: LanguagePreference;
    voiceStyle: VoiceStyle;
    customName?: string;
    customPrompt?: string;
    enableEmoji: boolean;
    formalityLevel: number;
}

export interface PersonalityPreset {
    id: string;
    name: string;
    description: string;
    avatar: string;
    settings: PersonalitySettings;
}

export interface RoleplayCharacter {
    id: string;
    name: string;
    avatar?: string | number;
    description: string;
    personality: string;
    tags: string[];
    systemPrompt?: string;
    system_prompt?: string;
    greeting?: string;
    nsfw?: boolean;
    isNSFW?: boolean;
    premium?: boolean;
}

/**
 * Analytics
 */
export interface UsageAnalytics {
    total_requests: number;
    successful_requests: number;
    average_response_time: number;
    requests_by_day: {
        date: string;
        count: number;
    }[];
}

export interface TokenAnalytics {
    total_tokens_used: number;
    average_daily_usage: number;
    tokens_by_day: {
        date: string;
        tokens: number;
    }[];
    tokens_by_feature: {
        feature: string;
        tokens: number;
    }[];
}

export interface ModelUsage {
    model: string;
    usage_count: number;
    percentage: number;
}

export interface PopularModels {
    models: ModelUsage[];
}
