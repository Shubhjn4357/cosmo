/**
 * Whisper App - Token Management Hook
 * Manages token balance, checks, and warnings
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { profileAPI } from '@/services/profileAPI';

export interface TokenInfo {
    tokensUsed: number;
    tokensLimit: number;
    tokensRemaining: number;
    isLow: boolean;
    tier: 'free' | 'pro' | 'unlimited';
}

export function useTokens() {
    const { user, profile, refreshProfile } = useAuth();
    const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
    const [isChecking, setIsChecking] = useState(false);

    // Update token info from profile
    useEffect(() => {
        if (profile) {
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
            });
        }
    }, [profile]);

    /**
     * Check if user has enough tokens for an action
     */
    const checkTokens = useCallback(
        async (requiredTokens: number): Promise<boolean> => {
            if (!tokenInfo) return false;
            return tokenInfo.tokensRemaining >= requiredTokens;
        },
        [tokenInfo]
    );

    /**
     * Use tokens for an action (calls backend)
     */
    const useTokens = useCallback(
        async (amount: number): Promise<boolean> => {
            if (!user?.id) return false;

            setIsChecking(true);
            try {
                const success = await profileAPI.useTokens(user.id, amount);
                if (success) {
                    await refreshProfile();
                }
                return success;
            } catch (error) {
                console.error('Failed to use tokens:', error);
                return false;
            } finally {
                setIsChecking(false);
            }
        },
        [user, refreshProfile]
    );

    /**
     * Get token cost for an action type
     */
    const getTokenCost = useCallback((action: string): number => {
        const costs: Record<string, number> = {
            chat: 1,
            image: 5,
            file_analysis: 2,
            face_swap: 3,
            upscale: 3,
            smart_mode: 2,
        };
        return costs[action] || 1;
    }, []);

    return {
        tokenInfo,
        checkTokens,
        useTokens,
        getTokenCost,
        isChecking,
        refreshTokens: refreshProfile,
    };
}
