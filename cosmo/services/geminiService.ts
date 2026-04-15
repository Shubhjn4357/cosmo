/**
 * Cosmo App - Gemini Service
 * Direct Gemini API integration for smart mode
 */

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

export interface GeminiResponse {
    response: string;
    model: string;
}

class GeminiService {
    private apiKey: string;

    constructor(apiKey: string = GEMINI_API_KEY) {
        this.apiKey = apiKey;
    }

    /**
     * Check if Gemini API is available
     */
    isAvailable(): boolean {
        return this.apiKey.length > 0;
    }

    /**
     * Generate response using Gemini
     */
    async generate(prompt: string, systemPrompt?: string): Promise<GeminiResponse> {
        if (!this.isAvailable()) {
            throw new Error ('Gemini API key not configured');
        }

        const fullPrompt = systemPrompt 
            ? `${systemPrompt}\n\nUser: ${prompt}` 
            : prompt;

        try {
            const response = await fetch(`${GEMINI_API_URL}?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: fullPrompt }]
                    }],
                    generationConfig: {
                        temperature: 0.9,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 1024,
                    },
                }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
            }

            const data = await response.json();
            const text = data.candidates[0]?.content?.parts[0]?.text || '';

            return {
                response: text,
                model: 'gemini-pro',
            };
        } catch (error) {
            console.error('Gemini API error:', error);
            throw error;
        }
    }

    /**
     * Analyze query type for smart routing
     */
    analyzeQueryType(prompt: string): 'creative' | 'factual' | 'code' | 'general' {
        const lowerPrompt = prompt.toLowerCase();
        
        if (lowerPrompt.includes('write') || lowerPrompt.includes('story') || lowerPrompt.includes('poem')) {
            return 'creative';
        }
        if (lowerPrompt.includes('code') || lowerPrompt.includes('function') || lowerPrompt.includes('debug')) {
            return 'code';
        }
        if (lowerPrompt.includes('what is') || lowerPrompt.includes('who is') || lowerPrompt.includes('when')) {
            return 'factual';
        }
        return 'general';
    }
}

export const geminiService = new GeminiService();
export default geminiService;
