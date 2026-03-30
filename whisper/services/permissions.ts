/**
 * Whisper App - Permission Manager
 * Handles all permission requests with graceful denial handling
 */

import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PERMISSION_KEY = 'Whisper_permissions_requested';

export interface PermissionStatus {
    camera: boolean;
    mediaLibrary: boolean;
    notifications: boolean;
}

/**
 * Check if permissions have been requested before
 */
export async function hasRequestedPermissions(): Promise<boolean> {
    const requested = await AsyncStorage.getItem(PERMISSION_KEY);
    return requested === 'true';
}

/**
 * Mark permissions as requested
 */
export async function markPermissionsRequested(): Promise<void> {
    await AsyncStorage.setItem(PERMISSION_KEY, 'true');
}

/**
 * Open device settings
 */
export function openSettings(): void {
    Linking.openSettings();
}

/**
 * Request camera permission
 */
export async function requestCameraPermission(): Promise<boolean> {
    try {
        const { status: existingStatus } = await ImagePicker.getCameraPermissionsAsync();
        
        if (existingStatus === 'granted') {
            return true;
        }

        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        
        if (status !== 'granted') {
            handlePermissionDenied('Camera', 'take photos for AI analysis');
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Camera permission error:', error);
        return false;
    }
}

/**
 * Request media library/gallery permission
 */
export async function requestMediaLibraryPermission(): Promise<boolean> {
    try {
        const { status: existingStatus } = await ImagePicker.getMediaLibraryPermissionsAsync();
        
        if (existingStatus === 'granted') {
            return true;
        }

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        
        if (status !== 'granted') {
            handlePermissionDenied('Photo Library', 'select images for AI analysis');
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Media library permission error:', error);
        return false;
    }
}

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
    try {
        // Check if physical device (notifications don't work in simulator)
        if (!Device.isDevice) {
            console.log('Notifications require a physical device');
            return false;
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        
        if (existingStatus === 'granted') {
            return true;
        }

        const { status } = await Notifications.requestPermissionsAsync();
        
        if (status !== 'granted') {
            handlePermissionDenied('Notifications', 'receive task completion alerts');
            return false;
        }

        // Setup notification channel for Android
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'Whisper AI',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#F59E0B',
            });
        }
        
        return true;
    } catch (error) {
        console.error('Notification permission error:', error);
        return false;
    }
}

/**
 * Request all required permissions
 */
export async function requestAllPermissions(): Promise<PermissionStatus> {
    const [camera, mediaLibrary, notifications] = await Promise.all([
        requestCameraPermission(),
        requestMediaLibraryPermission(),
        requestNotificationPermission(),
    ]);

    await markPermissionsRequested();

    return { camera, mediaLibrary, notifications };
}

/**
 * Get current permission status
 */
export async function getPermissionStatus(): Promise<PermissionStatus> {
    try {
        const [cameraResult, mediaResult, notifResult] = await Promise.all([
            ImagePicker.getCameraPermissionsAsync(),
            ImagePicker.getMediaLibraryPermissionsAsync(),
            Notifications.getPermissionsAsync(),
        ]);

        return {
            camera: cameraResult.status === 'granted',
            mediaLibrary: mediaResult.status === 'granted',
            notifications: notifResult.status === 'granted',
        };
    } catch (error) {
        console.error('Error getting permission status:', error);
        return { camera: false, mediaLibrary: false, notifications: false };
    }
}

/**
 * Handle permission denial gracefully
 */
function handlePermissionDenied(permissionName: string, purpose: string): void {
    Alert.alert(
        `${permissionName} Permission Required`,
        `Whisper AI needs ${permissionName.toLowerCase()} access to ${purpose}. You can enable this in Settings.`,
        [
            { text: 'Not Now', style: 'cancel' },
            { text: 'Open Settings', onPress: openSettings },
        ]
    );
}

/**
 * Check if a specific feature can be used
 */
export async function canUseCamera(): Promise<boolean> {
    const { status } = await ImagePicker.getCameraPermissionsAsync();
    return status === 'granted';
}

export async function canUseGallery(): Promise<boolean> {
    const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
    return status === 'granted';
}

export async function canReceiveNotifications(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
}
