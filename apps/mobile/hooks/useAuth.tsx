/**
 * Cosmo AI - Authentication Context
 * Server-based auth using the Cosmo API.
 * The app does not connect directly to Supabase or Turso.
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { storage } from '@/utils/storage';
import { authAPI, profileAPI } from '@/services/profileAPI';
import { UserProfile, AuthSession, AuthUser } from '@/types';

// Storage keys
const STORAGE_KEYS = {
    ONBOARDING_COMPLETE: '@cosmo_onboarding_complete',
    CONSENT_GIVEN: '@cosmo_consent_given',
    SESSION: '@cosmo_session',
};

interface AuthContextType {
    // State
    user: AuthUser | null;
    profile: UserProfile | null;
    session: AuthSession | null;
    isLoading: boolean;
    isAuthenticated: boolean;

    // Onboarding state
    hasCompletedOnboarding: boolean;
    hasGivenConsent: boolean;

    // Auth actions (return { success, error } for toast handling by caller)
    signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    signUp: (email: string, password: string, displayName?: string) => Promise<{ success: boolean; error?: string }>;
    signInWithGoogle: (idToken: string) => Promise<{ success: boolean; error?: string }>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<{ success: boolean; message?: string; error?: string }>;

    // Profile actions
    refreshProfile: () => Promise<void>;
    updateProfile: (updates: Partial<UserProfile>) => Promise<boolean>;

    // Onboarding actions
    completeOnboarding: () => Promise<void>;
    acceptConsent: (dataCollectionConsent: boolean) => Promise<boolean>;

    // Token management
    hasTokensAvailable: () => Promise<boolean>;
    useTokens: (amount: number) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [session, setSession] = useState<AuthSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
    const [hasGivenConsent, setHasGivenConsent] = useState(false);

    const isAuthenticated = !!user && !!session;

    useEffect(() => {
        initializeAuth();
        loadOnboardingState();
    }, []);

    const loadOnboardingState = async () => {
        try {
            const [onboarding, consent] = await Promise.all([
                storage.getItem<string>(STORAGE_KEYS.ONBOARDING_COMPLETE),
                storage.getItem<string>(STORAGE_KEYS.CONSENT_GIVEN),
            ]);

            setHasCompletedOnboarding(onboarding === 'true');
            setHasGivenConsent(consent === 'true');
        } catch (error) {
            console.error('Error loading onboarding state:', error);
        }
    };

    const initializeAuth = async () => {
        try {
            // Load session from storage
            const storedSession = await storage.getItem<AuthSession>(STORAGE_KEYS.SESSION);
            if (storedSession) {
                setSession(storedSession);
                setUser(storedSession.user);

                if (storedSession.user?.id) {
                    await loadProfile(storedSession.user.id);
                }
            }
        } catch (error) {
            console.error('Error initializing auth:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadProfile = async (userId: string) => {
        try {
            let userProfile = await profileAPI.getProfile(userId);

            // Create profile if not exists
            if (!userProfile) {
                userProfile = await profileAPI.createProfile(userId, user?.email || null, user?.user_metadata?.full_name);
            }

            // Sync consent: Local -> Server
            const localConsent = await storage.getItem<string>(STORAGE_KEYS.CONSENT_GIVEN);
            if (localConsent === 'true' && userProfile && !userProfile.consent_given) {
                // We have local consent but server doesn't know. Sync it.
                await profileAPI.acceptConsent(userId, true);
                userProfile.consent_given = true;
            }

            // Sync consent: Server -> Local
            if (userProfile?.consent_given) {
                setHasGivenConsent(true);
                await storage.setItem(STORAGE_KEYS.CONSENT_GIVEN, 'true');
            }

            setProfile(userProfile);
        } catch (error) {
            console.error('Error loading profile:', error);
        }
    };

    const signIn = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const { session: newSession, error } = await authAPI.signIn(email, password);

            if (error) {
                return { success: false, error };
            }

            if (newSession) {
                setSession(newSession);
                setUser(newSession.user);
                await storage.setItem(STORAGE_KEYS.SESSION, newSession);
                await loadProfile(newSession.user.id);
            }

            return { success: true };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to sign in';
            return { success: false, error: errorMessage };
        }
    };

    const signUp = async (email: string, password: string, displayName?: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const { success, session: newSession, error } = await authAPI.signUp(email, password, displayName);

            if (!success) {
                return { success: false, error: error || 'Failed to sign up' };
            }

            if (newSession) {
                setSession(newSession);
                setUser(newSession.user);
                await storage.setItem(STORAGE_KEYS.SESSION, newSession);
                await loadProfile(newSession.user.id);
            }

            return { success: true };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to sign up';
            return { success: false, error: errorMessage };
        }
    };

    const signInWithGoogle = async (idToken: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const { session: newSession, error } = await authAPI.signInWithGoogle(idToken);

            if (error) {
                return { success: false, error };
            }

            if (newSession) {
                setSession(newSession);
                setUser(newSession.user);
                await storage.setItem(STORAGE_KEYS.SESSION, newSession);
                await loadProfile(newSession.user.id);
            }

            return { success: true };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to sign in with Google';
            return { success: false, error: errorMessage };
        }
    };

    const signOut = async () => {
        try {
            await authAPI.signOut();
            setUser(null);
            setProfile(null);
            setSession(null);
            await storage.clearNamespace('@cosmo_'); // Clear session and onboarding
            await storage.removeItem(STORAGE_KEYS.SESSION);
            await storage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE);
            await storage.removeItem(STORAGE_KEYS.CONSENT_GIVEN);
            setHasCompletedOnboarding(false);
            setHasGivenConsent(false);
        } catch (error) {
            console.error('Error signing out:', error);
        }
    };

    const resetPassword = async (email: string): Promise<{ success: boolean; message?: string; error?: string }> => {
        try {
            const success = await authAPI.resetPassword(email);
            if (success) {
                return { success: true, message: 'Password reset email sent. Please check your inbox.' };
            }
            return { success: false, error: 'Failed to send reset email' };
        } catch (error) {
            return { success: false, error: 'Failed to send reset email' };
        }
    };

    const refreshProfile = async () => {
        if (user?.id) {
            await loadProfile(user.id);
        }
    };

    const updateProfile = async (updates: Partial<UserProfile>): Promise<boolean> => {
        if (!user?.id) return false;

        try {
            const success = await profileAPI.updateProfile(user.id, updates);
            if (success) {
                await refreshProfile();
            }
            return success;
        } catch (error) {
            console.error('Error updating profile:', error);
            return false;
        }
    };

    const completeOnboarding = async () => {
        await storage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETE, 'true');
        setHasCompletedOnboarding(true);
    };

    const acceptConsent = async (dataCollectionConsent: boolean): Promise<boolean> => {
        try {
            // Always save locally first
            await storage.setItem(STORAGE_KEYS.CONSENT_GIVEN, 'true');
            setHasGivenConsent(true);

            // If user is logged in, sync to server
            if (user?.id) {
                await profileAPI.acceptConsent(user.id, dataCollectionConsent);
                await refreshProfile();
            }

            return true;
        } catch (error) {
            console.error('Error accepting consent:', error);
            // Even if server sync fails, return true as we saved locally
            return true;
        }
    };

    const hasTokensAvailable = async (): Promise<boolean> => {
        return true;
    };

    const useTokens = async (_amount: number): Promise<boolean> => {
        return true;
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                profile,
                session,
                isLoading,
                isAuthenticated,
                hasCompletedOnboarding,
                hasGivenConsent,
                signIn,
                signUp,
                signInWithGoogle,
                signOut,
                resetPassword,
                refreshProfile,
                updateProfile,
                completeOnboarding,
                acceptConsent,
                hasTokensAvailable,
                useTokens,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
