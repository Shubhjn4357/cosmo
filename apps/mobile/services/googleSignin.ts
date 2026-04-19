import Constants from 'expo-constants';
import { Platform } from 'react-native';

type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

type GoogleSigninFailureReason =
    | 'web_unsupported'
    | 'module_unavailable'
    | 'missing_client_id'
    | 'configure_failed'
    | 'play_services_unavailable'
    | 'sign_in_cancelled'
    | 'in_progress'
    | 'unexpected_response'
    | 'unknown';

type GoogleSigninFailure = {
    success: false;
    reason: GoogleSigninFailureReason;
    error?: Error;
};

type GoogleSigninSuccess = {
    success: true;
    idToken: string | null;
    user: {
        email?: string | null;
        name?: string | null;
        photo?: string | null;
    } | null;
};

export type NativeGoogleSigninResult = GoogleSigninFailure | GoogleSigninSuccess;

let googleSigninModulePromise: Promise<GoogleSigninModule | null> | null = null;
let googleSigninConfigured = false;

function getGoogleConfig() {
    const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

    return {
        webClientId:
            process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
            extra.googleWebClientId,
        iosClientId:
            process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
            extra.googleIosClientId,
    };
}

async function loadGoogleSigninModule(): Promise<GoogleSigninModule | null> {
    if (Platform.OS === 'web') {
        return null;
    }

    if (!googleSigninModulePromise) {
        googleSigninModulePromise = import('@react-native-google-signin/google-signin')
            .then((module) => module)
            .catch((error) => {
                console.error('Google Sign-In native module is unavailable:', error);
                return null;
            });
    }

    return googleSigninModulePromise;
}

export async function ensureGoogleSigninConfigured(): Promise<boolean> {
    const googleModule = await loadGoogleSigninModule();
    if (!googleModule?.GoogleSignin) {
        return false;
    }

    if (googleSigninConfigured) {
        return true;
    }

    const { webClientId, iosClientId } = getGoogleConfig();
    if (!webClientId) {
        console.warn('Google Sign-In is missing a web client id.');
        return false;
    }

    try {
        googleModule.GoogleSignin.configure({
            webClientId,
            iosClientId,
            offlineAccess: true,
            scopes: ['profile', 'email'],
        });
        googleSigninConfigured = true;
        return true;
    } catch (error) {
        console.error('Failed to configure Google Sign-In:', error);
        return false;
    }
}

export async function performNativeGoogleSignin(): Promise<NativeGoogleSigninResult> {
    if (Platform.OS === 'web') {
        return { success: false, reason: 'web_unsupported' };
    }

    const googleModule = await loadGoogleSigninModule();
    if (!googleModule?.GoogleSignin) {
        return { success: false, reason: 'module_unavailable' };
    }

    const isConfigured = await ensureGoogleSigninConfigured();
    if (!isConfigured) {
        return {
            success: false,
            reason: getGoogleConfig().webClientId ? 'configure_failed' : 'missing_client_id',
        };
    }

    try {
        if (Platform.OS === 'android') {
            await googleModule.GoogleSignin.hasPlayServices({
                showPlayServicesUpdateDialog: true,
            });
        }

        const response = await googleModule.GoogleSignin.signIn();
        if (!googleModule.isSuccessResponse(response)) {
            return {
                success: false,
                reason: 'unexpected_response',
                error: new Error('Google Sign-In returned an unexpected response.'),
            };
        }

        return {
            success: true,
            idToken: response.data.idToken ?? null,
            user: response.data.user
                ? {
                      email: response.data.user.email ?? null,
                      name: response.data.user.name ?? null,
                      photo: response.data.user.photo ?? null,
                  }
                : null,
        };
    } catch (error) {
        const typedError =
            error instanceof Error ? error : new Error(String(error));

        if (googleModule.isErrorWithCode(error)) {
            if (error.code === googleModule.statusCodes.SIGN_IN_CANCELLED) {
                return { success: false, reason: 'sign_in_cancelled', error: typedError };
            }
            if (error.code === googleModule.statusCodes.IN_PROGRESS) {
                return { success: false, reason: 'in_progress', error: typedError };
            }
            if (error.code === googleModule.statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
                return {
                    success: false,
                    reason: 'play_services_unavailable',
                    error: typedError,
                };
            }
        }

        return { success: false, reason: 'unknown', error: typedError };
    }
}
