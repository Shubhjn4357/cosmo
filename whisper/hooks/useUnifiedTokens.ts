/**
 * Unified Token Hook - Handles both guest and authenticated users
 * 5 free tokens for guests (persistent via AsyncStorage)
 * Full token management for logged-in users
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useGuest } from './useGuest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';

export interface UnifiedTokenInfo {
    tokensUsed: number;
    tokensLimit: number;
    tokensRemaining: number;
    isLow: boolean;
    tier: 'guest' | 'free' | 'pro';
    isGuest: boolean;
    sessionId?: string;
}

export function useUnifiedTokens() {
    const { user, profile, isAuthenticated } = useAuth();
   
const guest = useGuest();
    const [tokenInfo, setTokenInfo] = useState<UnifiedTokenInfo | null>(null);

    // Update token info based on auth state
    useEffect(() => {
        if (isAuthenticated && profile) {
            // Logged-in user
            const tokensUsed = profile.tokens_used || 0;
            const tokensLimit = profile.tokens_limit || 20;
            const tokensRemaining = Math.max(0, tokensLimit - tokensUsed);
            const isLow = tokensRemaining / tokensLimit < 0.2;

            setTokenInfo({
                tokensUsed,
                tokensLimit,
                tokensRemaining,
                isLow,
                tier: profile.subscription_tier || 'free',
                isGuest: false,
            });
        } else if (!guest.isLoading) {
            // Guest user
            setTokenInfo({
                tokensUsed: 5 - guest.tokens,
                tokensLimit: 5,
                tokensRemaining: guest.tokens,
                isLow: guest.tokens <= 1,
                tier: 'guest',
                isGuest: true,
                sessionId: guest.sessionId,
            });
        }
    }, [isAuthenticated, profile, guest.tokens, guest.isLoading, guest.sessionId]);

    /**
     * Check if user has enough tokens
     */
    const checkTokens = useCallback(
        async (requiredTokens: number): Promise<boolean> => {
            if (!tokenInfo) return false;
            return tokenInfo.tokensRemaining >= requiredTokens;
        },
        [tokenInfo]
    );

    /**
     * Use tokens - works for both guest and authenticated users
     */
    const useTokens = useCallback(
        async (amount: number, feature: string = 'chat'): Promise<boolean> => {
            if (isAuthenticated && user?.id) {
                // Authenticated user - use backend
                try {
                    // Backend will handle token deduction
                    return true; // Let backend decide
                } catch (error) {
                    console.error('Failed to check tokens:', error);
                    return false;
                }
            } else {
                // Guest user - use local storage
                return await guest.useTokens(amount);
            }
        },
        [isAuthenticated, user, guest]
    );

    /**
     * Get token cost for an action
     */
    const getTokenCost = useCallback((action: string): number => {
        const costs: Record<string, number> = {
            chat: 1,
            image: 5,
            file_analysis: 2,
            face_swap: 3,
            upscale: 3,
            smart_mode: 2,
            roleplay: 1,
        };
        return costs[action] || 1;
    }, []);

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
        isLoading: guest.isLoading,
        // Guest-specific methods
        isGuest: !isAuthenticated,
        clearGuestData: guest.clearGuest,
    };
}
