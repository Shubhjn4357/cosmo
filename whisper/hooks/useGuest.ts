/**
 * Guest Mode Hook
 * Manages guest users with 5 free tokens (no signup required)
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { whisperAPI } from '@/services/api';

const GUEST_TOKEN_KEY = 'guest_tokens';
const GUEST_SESSION_KEY = 'guest_session_id';
const GUEST_TOKEN_LIMIT = 5;

interface GuestState {
  tokens: number;
  sessionId: string;
  isGuest: boolean;
}

export function useGuest() {
  const [guestTokens, setGuestTokens] = useState<number>(GUEST_TOKEN_LIMIT);
  const [sessionId, setSessionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // Initialize guest session
  useEffect(() => {
    initializeGuest();
  }, []);

  const initializeGuest = async () => {
    try {
      // Get or create session ID
      let sid = await AsyncStorage.getItem(GUEST_SESSION_KEY);
      if (!sid) {
        sid = generateSessionId();
        await AsyncStorage.setItem(GUEST_SESSION_KEY, sid);
      }
      setSessionId(sid);

      // Get stored tokens
      const storedTokens = await AsyncStorage.getItem(GUEST_TOKEN_KEY);
      if (storedTokens) {
        setGuestTokens(parseInt(storedTokens, 10));
      } else {
        setGuestTokens(GUEST_TOKEN_LIMIT);
        await AsyncStorage.setItem(GUEST_TOKEN_KEY, String(GUEST_TOKEN_LIMIT));
      }
    } catch (error) {
      console.error('Failed to initialize guest mode:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateSessionId = (): string => {
    return `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  const useTokens = useCallback(async (amount: number): Promise<boolean> => {
    if (guestTokens >= amount) {
      const newBalance = guestTokens - amount;
      setGuestTokens(newBalance);
      await AsyncStorage.setItem(GUEST_TOKEN_KEY, String(newBalance));
      return true;
    }
    return false;
  }, [guestTokens]);

  const resetTokens = useCallback(async () => {
    setGuestTokens(GUEST_TOKEN_LIMIT);
    await AsyncStorage.setItem(GUEST_TOKEN_KEY, String(GUEST_TOKEN_LIMIT));
  }, []);

  const clearGuest = useCallback(async () => {
    await AsyncStorage.removeItem(GUEST_TOKEN_KEY);
    await AsyncStorage.removeItem(GUEST_SESSION_KEY);
    setGuestTokens(GUEST_TOKEN_LIMIT);
    setSessionId('');
  }, []);

  return {
    tokens: guestTokens,
    sessionId,
    isGuest: true,
    isLoading,
    useTokens,
    resetTokens,
    clearGuest,
    hasTokens: (amount: number) => guestTokens >= amount,
  };
}
