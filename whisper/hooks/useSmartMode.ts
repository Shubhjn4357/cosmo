/**
 * Smart Mode Hook
 * Auto-selects best AI model based on prompt complexity and availability
 */

import { useState, useCallback } from 'react';
import { selectBestTextModel, SmartModelSelection } from '@/services/smartMode';
import { geminiService } from '@/services/geminiService';
import { whisperAPI } from '@/services/api';
import { localLLM } from '@/services/localLLM';

export type ModelInfo = SmartModelSelection;

interface SmartModeConfig {
    enabled?: boolean;
    showIndicator?: boolean;
}

export function useSmartMode(config: SmartModeConfig = {}) {
    const { enabled = false, showIndicator = true } = config;
    const [isSmartModeEnabled, setIsSmartModeEnabled] = useState(enabled);
    const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);

    const getModel = useCallback(async (prompt: string, requireSpeed: boolean = false, isPro: boolean = false) => {
        if (!isSmartModeEnabled) {
            return null; // Use default model
        }

        try {
            // Premium users get multi-model smart routing
            if (isPro) {
                const queryType = geminiService.analyzeQueryType(prompt);

                // Route based on query type
                switch (queryType) {
                    case 'creative':
                        return { model: 'gemini-pro', provider: 'gemini' };
                    case 'code':
                        return { model: 'whisper-chat', provider: 'whisper' };
                    case 'factual':
                        return { model: 'gemini-pro', provider: 'gemini' };
                    default:
                        // Check if local model is available
                        if (localLLM.isLoaded()) {
                            return { model: 'local', provider: 'local' };
                        }
                        return { model: 'whisper-chat', provider: 'whisper' };
                }
            }

            // Free users: use basic smart mode
            const model = await selectBestTextModel(prompt, requireSpeed);
            setSelectedModel(model);
            return model;
        } catch (error) {
            console.error('Smart mode selection failed:', error);
            return null;
        }
    }, [isSmartModeEnabled]);

    const toggleSmartMode = useCallback(() => {
        setIsSmartModeEnabled(prev => !prev);
    }, []);

    return {
        isSmartModeEnabled,
        selectedModel,
        getModel,
        toggleSmartMode,
    };
}

export default useSmartMode;
