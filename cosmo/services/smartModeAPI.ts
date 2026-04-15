/**
 * Cosmo App - Smart Mode API Service
 * Client-side service for Smart Mode multi-API chat
 */

import { cosmoAPI } from './api';

export interface SmartChatRequest {
    message: string;
    conversation_history?: Array<{ text: string; isUser: boolean }>;
    user_id?: string;
    max_tokens?: number;
}

export interface SmartChatResponse {
    response: string;
    model_used: string;
    response_time: number;
    success: boolean;
}

export interface SmartModeStatus {
    smart_mode_available: boolean;
    models: {
        gemini: boolean;
        nova: boolean;
        horde: boolean;
    };
    available_count: number;
}

export const smartModeAPI = {
    /**
     * Send chat message using Smart Mode (multi-API)
     */
    async chat(request: SmartChatRequest): Promise<SmartChatResponse> {
        try {
            const response = await fetch(`${cosmoAPI.getBaseUrl()}/api/chat/smart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Smart Mode request failed');
            }

            return await response.json();
        } catch (error) {
            console.error('Smart Mode error:', error);
            throw error;
        }
    },

    /**
     * Check Smart Mode status and available models
     */
    async getStatus(): Promise<SmartModeStatus> {
        try {
            const response = await fetch(`${cosmoAPI.getBaseUrl()}/api/chat/smart/status`);
            return await response.json();
        } catch (error) {
            console.error('Smart Mode status check failed:', error);
            return {
                smart_mode_available: false,
                models: { gemini: false, nova: false, horde: false },
                available_count: 0,
            };
        }
    },
};
