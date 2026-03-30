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

import llmBackend from '@/services/llmBackend';
import {
    DEFAULT_AI_RUNTIME,
    MODEL_MODE_SEQUENCE,
    MODEL_MODE_LABELS,
    type AIRuntimePreference,
    type ModelType,
} from '@/types';

const STORAGE_KEY = '@whisper_ai_runtime';

interface AIRuntimeContextValue extends AIRuntimePreference {
    isReady: boolean;
    isFreeMode: boolean;
    setMode: (mode: ModelType) => Promise<void>;
    cycleMode: () => Promise<ModelType>;
    setCloudModel: (model: string) => Promise<void>;
}

const AIRuntimeContext = createContext<AIRuntimeContextValue | undefined>(undefined);

function nextMode(mode: ModelType): ModelType {
    const index = MODEL_MODE_SEQUENCE.indexOf(mode);
    return MODEL_MODE_SEQUENCE[(index + 1) % MODEL_MODE_SEQUENCE.length];
}

export function AIRuntimeProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AIRuntimePreference>(DEFAULT_AI_RUNTIME);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            try {
                await llmBackend.loadConfigs();
                const saved = await AsyncStorage.getItem(STORAGE_KEY);
                if (saved && mounted) {
                    const parsed = JSON.parse(saved) as Partial<AIRuntimePreference>;
                    setState({
                        ...DEFAULT_AI_RUNTIME,
                        ...parsed,
                    });
                }
            } catch (error) {
                console.error('Failed to load AI runtime preferences:', error);
            } finally {
                if (mounted) {
                    setIsReady(true);
                }
            }
        };

        load();

        return () => {
            mounted = false;
        };
    }, []);

    const persist = useCallback(async (next: AIRuntimePreference) => {
        setState(next);
        try {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (error) {
            console.error('Failed to save AI runtime preferences:', error);
        }
    }, []);

    const setMode = useCallback(async (mode: ModelType) => {
        await persist({ ...state, mode });
    }, [persist, state]);

    const cycleMode = useCallback(async () => {
        const mode = nextMode(state.mode);
        await persist({ ...state, mode });
        return mode;
    }, [persist, state]);

    const setCloudModel = useCallback(async (cloudModel: string) => {
        await persist({ ...state, cloudModel });
        try {
            await llmBackend.updateBackend('gemini', {
                enabled: true,
                model: cloudModel,
            });
        } catch (error) {
            console.error('Failed to update Gemini model:', error);
        }
    }, [persist, state]);

    const value = useMemo<AIRuntimeContextValue>(() => ({
        ...state,
        isReady,
        isFreeMode: state.mode !== 'cloud',
        setMode,
        cycleMode,
        setCloudModel,
    }), [state, isReady, setMode, cycleMode, setCloudModel]);

    return (
        <AIRuntimeContext.Provider value={value}>
            {children}
        </AIRuntimeContext.Provider>
    );
}

export function useAIRuntime() {
    const context = useContext(AIRuntimeContext);
    if (!context) {
        return {
            ...DEFAULT_AI_RUNTIME,
            isReady: false,
            isFreeMode: DEFAULT_AI_RUNTIME.mode !== 'cloud',
            setMode: async () => {},
            cycleMode: async () => DEFAULT_AI_RUNTIME.mode,
            setCloudModel: async () => {},
        } satisfies AIRuntimeContextValue;
    }

    return context;
}

export function getModelModeLabel(mode: ModelType) {
    return MODEL_MODE_LABELS[mode];
}
