/**
 * Server Keepalive Hook
 * Prevents HuggingFace server from sleeping with automatic pinging
 * 
 * Usage:
 * const { isActive, lastPing, error } = useServerKeepalive({ 
 *   enabled: true, 
 *   interval: 30 * 60 * 1000 // 30 minutes
 * });
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { cosmoAPI } from '@/services/api';

interface KeepaliveOptions {
    enabled?: boolean;
    interval?: number; // milliseconds (default: 30 minutes)
    onSuccess?: (data: any) => void;
    onError?: (error: Error) => void;
}

interface KeepaliveState {
    isActive: boolean;
    lastPing: Date | null;
    nextPing: Date | null;
    error: Error | null;
    pingCount: number;
}

export function useServerKeepalive(options: KeepaliveOptions = {}) {
    const {
        enabled = true,
        interval = 30 * 60 * 1000, // 30 minutes default
        onSuccess,
        onError,
    } = options;

    const [state, setState] = useState<KeepaliveState>({
        isActive: false,
        lastPing: null,
        nextPing: null,
        error: null,
        pingCount: 0,
    });

    const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    // Ping function
    const ping = useCallback(async () => {
        if (!enabled) return;

        try {
            console.log('[Keepalive] Pinging server...');
            const response = await cosmoAPI.ping();

            const now = new Date();
            const next = new Date(now.getTime() + interval);

            setState(prev => ({
                ...prev,
                isActive: true,
                lastPing: now,
                nextPing: next,
                error: null,
                pingCount: prev.pingCount + 1,
            }));

            onSuccess?.(response);
            console.log('[Keepalive] ✅ Ping successful:', response);
        } catch (error) {
            console.error('[Keepalive] ❌ Ping failed:', error);
            setState(prev => ({
                ...prev,
                error: error as Error,
                isActive: false,
            }));

            onError?.(error as Error);
        }
    }, [enabled, interval, onSuccess, onError]);

    // Start keepalive
    const start = useCallback(() => {
        if (!enabled) return;

        console.log(`[Keepalive] Starting with ${interval / 60000} minute interval`);

        // Immediate ping
        ping();

        // Set up interval
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        intervalRef.current = setInterval(() => {
            ping();
        }, interval);

        setState(prev => ({ ...prev, isActive: true }));
    }, [enabled, interval, ping]);

    // Stop keepalive
    const stop = useCallback(() => {
        console.log('[Keepalive] Stopping');

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        setState(prev => ({ ...prev, isActive: false, nextPing: null }));
    }, []);

    // Handle app state changes
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextAppState) => {
            // Resume pinging when app becomes active
            if (
                appStateRef.current.match(/inactive|background/) &&
                nextAppState === 'active'
            ) {
                console.log('[Keepalive] App became active, resuming');
                if (enabled) {
                    start();
                }
            }

            // Stop pinging when app goes to background (optional - saves battery)
            if (
                appStateRef.current === 'active' &&
                nextAppState.match(/inactive|background/)
            ) {
                console.log('[Keepalive] App went to background, pausing');
                // Optionally stop to save battery, or keep running
                // stop();
            }

            appStateRef.current = nextAppState;
        });

        return () => {
            subscription.remove();
        };
    }, [enabled, start, stop]);

    // Auto-start on mount
    useEffect(() => {
        if (enabled) {
            start();
        }

        return () => {
            stop();
        };
    }, [enabled, start, stop]);

    // Manual ping
    const pingNow = useCallback(() => {
        ping();
    }, [ping]);

    return {
        ...state,
        start,
        stop,
        pingNow,
        isEnabled: enabled,
        interval,
    };
}

/**
 * Simpler version - just ping, no state management
 */
export function useSimpleKeepalive(intervalMinutes: number = 30) {
    useEffect(() => {
        const intervalMs = intervalMinutes * 60 * 1000;

        // Immediate ping
        cosmoAPI.ping().catch(console.error);

        // Set up interval
        const interval = setInterval(() => {
            cosmoAPI.ping()
                .then(() => console.log('[Keepalive] Ping OK'))
                .catch(err => console.error('[Keepalive] Ping failed:', err));
        }, intervalMs);

        return () => clearInterval(interval);
    }, [intervalMinutes]);
}
