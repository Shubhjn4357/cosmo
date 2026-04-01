/**
 * Whisper App - Profile API Service
 * Client-side service that calls the Whisper server API for auth, profiles,
 * history, and preferences. Persistent storage lives on the server in Turso.
 */

import { whisperAPI } from './api';

export interface UserProfile {
    id: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    consent_given: boolean;
    data_collection_consent: boolean;
    is_admin: boolean;
    created_at: string;
}

export interface ChatHistory {
    id: string;
    user_id: string;
    title: string;
    messages: any[];
    model_id: string | null;
    is_local: boolean;
    created_at: string;
    updated_at: string;
}

export interface AuthSession {
    access_token: string;
    refresh_token: string;
    user: any;
}

// ============================================================================
// AUTH API
// ============================================================================

export const authAPI = {
    /**
     * Sign in with email/password
     */
    async signIn(email: string, password: string): Promise<{ session: AuthSession | null; error: string | null }> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/auth/signin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await response.json();

            // Backend now returns { success, session: { access_token, refresh_token, user }, error }
            if (data.success && data.session) {
                return { session: data.session, error: null };
            }

            return { session: null, error: data.error || data.message || 'Login failed' };
        } catch (error) {
            return { session: null, error: String(error) };
        }
    },

    /**
     * Sign up with email/password
     * NOTE: If server-side email verification is enabled, the user may need to
     * confirm their email before a session is returned.
     */
    async signUp(email: string, password: string, displayName?: string): Promise<{ success: boolean; session: AuthSession | null; error: string | null }> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, display_name: displayName }),
            });
            const data = await response.json();

            // With email verification enabled, session might be null but success=true
            if (data.success) {
                if (data.session) {
                    // Email verification disabled - user logged in immediately
                    return { success: true, session: data.session, error: null };
                } else if (data.user) {
                    // Email verification enabled - user created but needs to confirm email
                    // Return success=true so UI shows success state, even though no session
                    return {
                        success: true,
                        session: null,
                        error: null 
                    };
                }
            }

            return { success: false, session: null, error: data.error || 'Signup failed' };
        } catch (error) {
            return { success: false, session: null, error: String(error) };
        }
    },

    /**
     * Sign in with Google
     */
    async signInWithGoogle(idToken: string): Promise<{ session: AuthSession | null; error: string | null }> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_token: idToken }),
            });
            const data = await response.json();
            return { session: data.success ? data.session : null, error: data.error || null };
        } catch (error) {
            return { session: null, error: String(error) };
        }
    },

    /**
     * Reset password
     */
    async resetPassword(email: string): Promise<{ error: string | null }> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await response.json();

            if (response.ok && data.success) {
                return { error: null };
            }

            return { error: data.message || 'Failed to send reset email' };
        } catch (error) {
            return { error: String(error) };
        }
    },

    /**
     * Sign out
     */
    async signOut(): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/auth/signout`, {
                method: 'POST',
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            return false;
        }
    },
};

// ============================================================================
// PROFILE API
// ============================================================================

export const profileAPI = {
    /**
     * Create a new profile
     * @param userId - User ID
     * @param email - User email
     * @param displayName - Optional display name
     * @param consentOptions - Optional consent flags (terms_accepted, consent_given, data_collection_consent)
     */
    async createProfile(
        userId: string,
        email: string | null,
        displayName?: string,
        consentOptions?: {
            terms_accepted?: boolean;
            consent_given?: boolean;
            data_collection_consent?: boolean;
        }
    ): Promise<UserProfile | null> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    email,
                    display_name: displayName,
                    terms_accepted: consentOptions?.terms_accepted ?? true,  // Default to true since they went through consent flow
                    consent_given: consentOptions?.consent_given ?? true,
                    data_collection_consent: consentOptions?.data_collection_consent ?? true,
                }),
            });
            const data = await response.json();
            return data.success ? data.profile : null;
        } catch (error) {
            console.error('Create profile error:', error);
            return null;
        }
    },

    /**
     * Get user profile
     */
    async getProfile(userId: string): Promise<UserProfile | null> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}`);
            const data = await response.json();
            return data.success ? data.profile : null;
        } catch (error) {
            console.error('Get profile error:', error);
            return null;
        }
    },

    /**
     * Update user profile
     */
    async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Update profile error:', error);
            return false;
        }
    },

    /**
     * Accept consent
     */
    async acceptConsent(userId: string, dataCollectionConsent: boolean): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}/consent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data_collection: dataCollectionConsent }),
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Accept consent error:', error);
            return false;
        }
    },

    /**
     * Use tokens
     */
    async useTokens(userId: string, amount: number): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}/tokens/use`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount }),
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Use tokens error:', error);
            return false;
        }
    },
};

// ============================================================================
// HISTORY API
// ============================================================================

export const historyAPI = {
    /**
     * Get all chat histories
     */
    async getHistories(userId: string): Promise<ChatHistory[]> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/history/${userId}`);
            const data = await response.json();
            return data.success ? data.histories : [];
        } catch (error) {
            console.error('Get histories error:', error);
            return [];
        }
    },

    /**
     * Create new chat
     */
    async createChat(userId: string, title: string, messages: any[]): Promise<string | null> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, title, messages }),
            });
            const data = await response.json();
            return data.success ? data.id : null;
        } catch (error) {
            console.error('Create chat error:', error);
            return null;
        }
    },

    /**
     * Update chat
     */
    async updateChat(chatId: string, updates: { title?: string; messages?: any[] }): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/history/${chatId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Update chat error:', error);
            return false;
        }
    },

    /**
     * Delete chat
     */
    async deleteChat(chatId: string): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/history/${chatId}`, {
                method: 'DELETE',
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Delete chat error:', error);
            return false;
        }
    },
};

// ============================================================================
// PREFERENCES API
// ============================================================================

export interface UserPreferences {
    nsfw_enabled: boolean;
    hf_model_preference: string;
    hf_api_key_set: boolean;
    theme: string;
    notifications_enabled: boolean;
}

export const preferencesAPI = {
    /**
     * Get all user preferences
     */
    async getPreferences(userId: string): Promise<UserPreferences | null> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}/preferences`);
            const data = await response.json();
            return data.success ? data.preferences : null;
        } catch (error) {
            console.error('Get preferences error:', error);
            return null;
        }
    },

    /**
     * Update NSFW mode preference
     */
    async updateNsfwPreference(userId: string, nsfwEnabled: boolean): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}/preferences/nsfw`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nsfw_enabled: nsfwEnabled }),
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Update NSFW preference error:', error);
            return false;
        }
    },

    /**
     * Update HuggingFace model preference
     */
    async updateHfModel(userId: string, model: string): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}/preferences/hf-model`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hf_model_preference: model }),
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Update HF model error:', error);
            return false;
        }
    },

    /**
     * Update HuggingFace API key
     */
    async updateHfApiKey(userId: string, apiKey: string): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}/preferences/hf-api-key`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hf_api_key: apiKey }),
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Update HF API key error:', error);
            return false;
        }
    },

    /**
     * Delete HuggingFace API key
     */
    async deleteHfApiKey(userId: string): Promise<boolean> {
        try {
            const response = await fetch(`${whisperAPI.getBaseUrl()}/api/profile/${userId}/preferences/hf-api-key`, {
                method: 'DELETE',
            });
            const data = await response.json();
            return data.success;
        } catch (error) {
            console.error('Delete HF API key error:', error);
            return false;
        }
    },
};
