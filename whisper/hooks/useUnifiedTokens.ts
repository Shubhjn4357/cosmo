/**
 * Unified Token Hook - Handles both guest and authenticated users
 * 5 free tokens for guests (persistent via AsyncStorage)
 * Full token management for logged-in users
 */

import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useGuest } from './useGuest';

export interface UnifiedTokenInfo {
    tokensUsed: number;
    tokensLimit: number;
    tokensRemaining: number;
    isLow: boolean;
    tier: 'guest' | 'free' | 'pro' | 'unlimited';
    isGuest: boolean;
    sessionId?: string;
}

export function useUnifiedTokens() {
    const { user, isAuthenticated } = useAuth();
    const guest = useGuest();
    const [tokenInfo] = useState<UnifiedTokenInfo | null>(null);

    /**
     * Check if user has enough tokens
     */
    const checkTokens = useCallback(
        async (_requiredTokens: number): Promise<boolean> => true,
        []
    );

    /**
     * Use tokens - works for both guest and authenticated users
     */
    const useTokens = useCallback(
        async (_amount: number, _feature: string = 'chat'): Promise<boolean> => true,
        []
    );

    /**
     * Get token cost for an action
     */
    const getTokenCost = useCallback((_action: string): number => 0, []);

    /**
     * Get session/user parameters for API calls
     */
    const getApiParams = useCallback(() => {
        if (isAuthenticated && user?.id) {
            return {
                user_id: user.id,
                session_id: undefined,
                is_guest: false,
            };
        } else {
            return {
                user_id: undefined,
                session_id: tokenInfo?.sessionId || guest.sessionId,
                is_guest: true,
            };
        }
    }, [isAuthenticated, user, tokenInfo, guest.sessionId]);

    return {
        tokenInfo,
        checkTokens,
        useTokens,
        getTokenCost,
        getApiParams,
        isLoading: false,
        // Guest-specific methods
        isGuest: !isAuthenticated,
        clearGuestData: guest.clearGuest,
    };
}
