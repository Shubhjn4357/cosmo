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

import { preferencesAPI } from '@/services/profileAPI';
import { useAuth } from './useAuth';

const STORAGE_KEY = '@Cosmo_app_preferences';

interface AppPreferencesState {
    enterToSend: boolean;
    nsfwEnabled: boolean;
}

interface AppPreferencesContextValue extends AppPreferencesState {
    isReady: boolean;
    setEnterToSend: (value: boolean) => Promise<void>;
    setNsfwEnabled: (value: boolean) => Promise<void>;
}

const DEFAULT_PREFERENCES: AppPreferencesState = {
    enterToSend: true,
    nsfwEnabled: false,
};

const AppPreferencesContext = createContext<AppPreferencesContextValue | undefined>(undefined);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
    const { profile } = useAuth();
    const [state, setState] = useState<AppPreferencesState>(DEFAULT_PREFERENCES);
    const [isReady, setIsReady] = useState(false);

    const persist = useCallback(async (next: AppPreferencesState) => {
        setState(next);
        try {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (error) {
            console.error('Failed to persist app preferences:', error);
        }
    }, []);

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            try {
                const saved = await AsyncStorage.getItem(STORAGE_KEY);
                if (saved && mounted) {
                    setState({
                        ...DEFAULT_PREFERENCES,
                        ...JSON.parse(saved),
                    });
                }
            } catch (error) {
                console.error('Failed to load app preferences:', error);
            } finally {
                if (mounted) {
                    setIsReady(true);
                }
            }
        };

        void load();

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!isReady || !profile?.id) {
            return;
        }

        let cancelled = false;

        const syncFromServer = async () => {
            try {
                const prefs = await preferencesAPI.getPreferences(profile.id);
                if (!prefs || cancelled || typeof prefs.nsfw_enabled !== 'boolean') {
                    return;
                }

                const next = {
                    ...DEFAULT_PREFERENCES,
                    ...state,
                    nsfwEnabled: prefs.nsfw_enabled,
                };
                if (
                    next.enterToSend !== state.enterToSend
                    || next.nsfwEnabled !== state.nsfwEnabled
                ) {
                    await persist(next);
                }
            } catch (error) {
                console.error('Failed to sync app preferences from server:', error);
            }
        };

        void syncFromServer();

        return () => {
            cancelled = true;
        };
    }, [isReady, persist, profile?.id, state]);

    const setEnterToSend = useCallback(async (value: boolean) => {
        await persist({
            ...state,
            enterToSend: value,
        });
    }, [persist, state]);

    const setNsfwEnabled = useCallback(async (value: boolean) => {
        const next = {
            ...state,
            nsfwEnabled: value,
        };

        await persist(next);

        if (profile?.id) {
            try {
                await preferencesAPI.updateNsfwPreference(profile.id, value);
            } catch (error) {
                console.error('Failed to sync NSFW preference:', error);
            }
        }
    }, [persist, profile?.id, state]);

    const value = useMemo<AppPreferencesContextValue>(() => ({
        ...state,
        isReady,
        setEnterToSend,
        setNsfwEnabled,
    }), [state, isReady, setEnterToSend, setNsfwEnabled]);

    return (
        <AppPreferencesContext.Provider value={value}>
            {children}
        </AppPreferencesContext.Provider>
    );
}

export function useAppPreferences() {
    const context = useContext(AppPreferencesContext);
    if (context) {
        return context;
    }

    return {
        ...DEFAULT_PREFERENCES,
        isReady: false,
        setEnterToSend: async () => {},
        setNsfwEnabled: async () => {},
    } satisfies AppPreferencesContextValue;
}
