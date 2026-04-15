/**
 * Cosmo AI — Offline-Aware App Preferences Hook
 * All settings stored locally first, synced when online.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveOfflineFirst, loadOfflineFirst } from '@/services/offlineSync';

const PREFS_KEY = '@cosmo_app_prefs';

export interface AppPreferences {
    /** Offline model: auto-select smallest available */
    offlineModelId: string;
    /** Whether to prefer local inference over cloud */
    preferLocalInference: boolean;
    /** Auto-sync when online */
    autoSync: boolean;
    /** Save chat history locally */
    saveChatHistory: boolean;
    /** Max offline history entries */
    maxOfflineHistory: number;
    /** UI density */
    density: 'compact' | 'comfortable' | 'spacious';
}

const DEFAULT_PREFS: AppPreferences = {
    offlineModelId: 'auto',
    preferLocalInference: true,
    autoSync: true,
    saveChatHistory: true,
    maxOfflineHistory: 200,
    density: 'comfortable',
};

export function useOfflinePreferences() {
    const [prefs, setPrefs] = useState<AppPreferences>(DEFAULT_PREFS);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        loadOfflineFirst<AppPreferences>(PREFS_KEY, undefined, DEFAULT_PREFS).then((loaded) => {
            if (loaded) setPrefs({ ...DEFAULT_PREFS, ...loaded });
            setIsLoaded(true);
        });
    }, []);

    const updatePrefs = useCallback(async (updates: Partial<AppPreferences>) => {
        const next = { ...prefs, ...updates };
        setPrefs(next);
        await saveOfflineFirst(
            PREFS_KEY,
            next,
            '/api/admin/user/preferences',
            'POST',
            'app_preferences'
        );
    }, [prefs]);

    return { prefs, isLoaded, updatePrefs };
}
