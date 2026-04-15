/**
 * Cosmo AI — Network Status Hook (Offline-First Enhanced)
 * Monitors device connectivity + server reachability.
 * Integrates with offlineSync to trigger queue drain on reconnect.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { cosmoAPI } from '@/services/api';
import { initOfflineSync, onNetworkChange, getPendingSyncCount } from '@/services/offlineSync';
import { useApiBase } from '@/hooks/useApiBase';

export interface NetworkStatus {
    isConnected: boolean;
    isServerReachable: boolean;
    isChecking: boolean;
    isOfflineMode: boolean;          // true = can use app, but no cloud
    pendingSyncCount: number;        // items queued for when back online
    lastChecked: Date | null;
    connectionType: string | null;
}

export function useNetworkStatus() {
    const { baseUrl } = useApiBase();
    const [status, setStatus] = useState<NetworkStatus>({
        isConnected: true,
        isServerReachable: false,
        isChecking: true,
        isOfflineMode: true,
        pendingSyncCount: 0,
        lastChecked: null,
        connectionType: null,
    });

    const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isMounted = useRef(true);

    // Init offline sync engine once baseUrl is known
    useEffect(() => {
        if (baseUrl) {
            initOfflineSync(baseUrl);
        }
    }, [baseUrl]);

    // Listen for sync engine network changes
    useEffect(() => {
        const unsub = onNetworkChange(async (online) => {
            if (!isMounted.current) return;
            const pending = await getPendingSyncCount();
            setStatus((prev) => ({
                ...prev,
                isOfflineMode: !online,
                pendingSyncCount: pending,
            }));
        });
        return unsub;
    }, []);

    const checkServer = useCallback(async () => {
        if (!isMounted.current) return;
        setStatus((prev) => ({ ...prev, isChecking: true }));

        try {
            const health = await cosmoAPI.getHealth();
            const pending = await getPendingSyncCount();
            if (!isMounted.current) return;
            setStatus((prev) => ({
                ...prev,
                isServerReachable: !!health,
                isOfflineMode: false,
                isChecking: false,
                pendingSyncCount: pending,
                lastChecked: new Date(),
            }));
        } catch {
            const pending = await getPendingSyncCount();
            if (!isMounted.current) return;
            setStatus((prev) => ({
                ...prev,
                isServerReachable: false,
                isOfflineMode: true,
                isChecking: false,
                pendingSyncCount: pending,
                lastChecked: new Date(),
            }));
        }
    }, []);

    const retry = useCallback(async () => { await checkServer(); }, [checkServer]);

    useEffect(() => {
        isMounted.current = true;

        const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
            if (!isMounted.current) return;
            setStatus((prev) => ({
                ...prev,
                isConnected: state.isConnected ?? false,
                connectionType: state.type,
            }));
            if (state.isConnected) {
                void checkServer();
            } else {
                setStatus((prev) => ({
                    ...prev,
                    isServerReachable: false,
                    isOfflineMode: true,
                }));
            }
        });

        void checkServer();
        checkIntervalRef.current = setInterval(checkServer, 30_000);

        return () => {
            isMounted.current = false;
            unsubscribe();
            if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
        };
    }, [checkServer]);

    return { ...status, retry, checkServer };
}

export default useNetworkStatus;
