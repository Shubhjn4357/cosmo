/**
 * Whisper App - useNetworkStatus Hook
 * Monitors network connectivity and server reachability
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { whisperAPI } from '@/services/api';

export interface NetworkStatus {
    isConnected: boolean;
    isServerReachable: boolean;
    isChecking: boolean;
    lastChecked: Date | null;
    connectionType: string | null;
}

export function useNetworkStatus() {
    const [status, setStatus] = useState<NetworkStatus>({
        isConnected: true,
        isServerReachable: false,
        isChecking: true,
        lastChecked: null,
        connectionType: null,
    });

    const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Check server connectivity
    const checkServer = useCallback(async () => {
        setStatus(prev => ({ ...prev, isChecking: true }));

        try {
            const health = await whisperAPI.getHealth();
            setStatus(prev => ({
                ...prev,
                isServerReachable: !!health,
                isChecking: false,
                lastChecked: new Date(),
            }));
        } catch (error) {
            setStatus(prev => ({
                ...prev,
                isServerReachable: false,
                isChecking: false,
                lastChecked: new Date(),
            }));
        }
    }, []);

    // Manual retry
    const retry = useCallback(async () => {
        await checkServer();
    }, [checkServer]);

    // Network state listener
    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
            setStatus(prev => ({
                ...prev,
                isConnected: state.isConnected ?? false,
                connectionType: state.type,
            }));

            // Check server when network comes back
            if (state.isConnected) {
                checkServer();
            } else {
                setStatus(prev => ({
                    ...prev,
                    isServerReachable: false,
                }));
            }
        });

        // Initial check
        checkServer();

        // Periodic check every 30 seconds
        checkIntervalRef.current = setInterval(checkServer, 30000);

        return () => {
            unsubscribe();
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
            }
        };
    }, [checkServer]);

    return {
        ...status,
        retry,
        checkServer,
    };
}

export default useNetworkStatus;
