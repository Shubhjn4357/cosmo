/**
 * Cosmo App - Deep Linking & Share Utilities
 * Handles app links and sharing functionality
 */

import { Share, Linking, Platform } from 'react-native';
import * as ExpoLinking from 'expo-linking';

// App configuration
export const APP_CONFIG = {
    scheme: 'Cosmo',
    package: 'com.Cosmo.ai',
    appStoreId: '', // Add your App Store ID when published
    playStoreId: 'com.Cosmo.ai',
    domain: 'cosmo-ai.app', // Your domain for universal links
};

/**
 * Build a deep link URL that opens the app
 * 
 * @param path - Route path (e.g., '/chat', '/create')
 * @param params - Query parameters
 * @returns Deep link URL
 * 
 * @example
 * buildDeepLink('/chat', { id: '123' })
 * // Returns: "Cosmo://chat?id=123"
 */
export function buildDeepLink(path: string = '', params?: Record<string, string>): string {
    const url = ExpoLinking.createURL(path, { queryParams: params });
    return url;
}

/**
 * Build a universal link (HTTPS) that opens the app
 * Falls back to app store if not installed
 * 
 * @param path - Route path
 * @returns Universal link URL
 */
export function buildUniversalLink(path: string = ''): string {
    return `https://${APP_CONFIG.domain}${path}`;
}

/**
 * Get the app store link for the current platform
 */
export function getAppStoreLink(): string {
    if (Platform.OS === 'ios') {
        return APP_CONFIG.appStoreId 
            ? `https://apps.apple.com/app/id${APP_CONFIG.appStoreId}`
            : `https://apps.apple.com/app/cosmo-ai`;
    } else {
        return `https://play.google.com/store/apps/details?id=${APP_CONFIG.playStoreId}`;
    }
}

/**
 * Share the app with others
 * 
 * @param customMessage - Optional custom message
 */
export async function shareApp(customMessage?: string): Promise<void> {
    const appLink = getAppStoreLink();
    const deepLink = buildDeepLink();
    
    const message = customMessage || 
        `🤖 Check out Cosmo AI - Your powerful AI assistant!\n\n` +
        `Download now: ${appLink}\n\n` +
        `Or open directly: ${deepLink}`;

    try {
        await Share.share({
            message,
            title: 'Cosmo AI - AI Assistant',
        });
    } catch (error) {
        console.error('Share failed:', error);
    }
}

/**
 * Share a specific screen/content
 * 
 * @param path - App route to share (e.g., '/chat/123')
 * @param title - Title for the share
 * @param message - Share message
 */
export async function shareContent(
    path: string,
    title: string,
    message?: string
): Promise<void> {
    const deepLink = buildDeepLink(path);
    
    const shareMessage = message 
        ? `${message}\n\nOpen in Cosmo AI: ${deepLink}`
        : `Check this out in Cosmo AI: ${deepLink}`;

    try {
        await Share.share({
            message: shareMessage,
            title,
        });
    } catch (error) {
        console.error('Share failed:', error);
    }
}

/**
 * Handle incoming deep links
 * Call this in your app's root component
 */
export function useDeepLinking(onLink: (url: string, path: string) => void) {
    // Get the initial URL (app opened via link)
    ExpoLinking.getInitialURL().then((url) => {
        if (url) {
            const { path } = ExpoLinking.parse(url);
            onLink(url, path || '/');
        }
    });

    // Listen for links while app is open
    const subscription = Linking.addEventListener('url', (event) => {
        const { path } = ExpoLinking.parse(event.url);
        onLink(event.url, path || '/');
    });

    return () => subscription.remove();
}

// Quick share links
export const SHARE_LINKS = {
    // Deep links (open app directly)
    app: 'Cosmo://',
    chat: 'Cosmo://chat',
    create: 'Cosmo://create',
    models: 'Cosmo://models',
    settings: 'Cosmo://settings',
    
    // With parameters
    chatWithPrompt: (prompt: string) => `Cosmo://chat?prompt=${encodeURIComponent(prompt)}`,
    createWithPrompt: (prompt: string) => `Cosmo://create?prompt=${encodeURIComponent(prompt)}`,
};

export default {
    buildDeepLink,
    buildUniversalLink,
    getAppStoreLink,
    shareApp,
    shareContent,
    useDeepLinking,
    SHARE_LINKS,
    APP_CONFIG,
};
