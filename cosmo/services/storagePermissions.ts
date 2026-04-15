/**
 * Cosmo App - Storage Permissions Helper
 * Handles external storage permissions for Android
 */

import { Platform, PermissionsAndroid } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

export class StoragePermissions {
    /**
     * Request external storage permissions on Android
     */
    static async requestPermissions(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true; // iOS doesn't need external storage permissions
        }

        try {
            const granted = await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
                PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
            ]);

            return (
                granted['android.permission.READ_EXTERNAL_STORAGE'] === PermissionsAndroid.RESULTS.GRANTED &&
                granted['android.permission.WRITE_EXTERNAL_STORAGE'] === PermissionsAndroid.RESULTS.GRANTED
            );
        } catch (err) {
            console.error('Permission request error:', err);
            return false;
        }
    }

    /**
     * Check if we have storage permissions
     */
    static async hasPermissions(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true;
        }

        try {
            const readGranted = await PermissionsAndroid.check(
                PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
            );
            const writeGranted = await PermissionsAndroid.check(
                PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
            );

            return readGranted && writeGranted;
        } catch (err) {
            console.error('Permission check error:', err);
            return false;
        }
    }

    /**
     * Get the models directory path
     * Uses app's internal document directory (no permissions needed)
     * iOS: file:///.../Documents/models/
     * Android: file:///.../files/models/
     */
    public static getModelsDirectory(): string {
        const modelDir = Platform.OS === 'ios'
            ? `${FileSystem.documentDirectory}models/`
            : `${FileSystem.documentDirectory}models/`;

        try {
            // Ensure directory exists
            FileSystem.getInfoAsync(modelDir).then(async (info) => {
                if (!info.exists) {
                    await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
                    console.log('Models directory created:', modelDir);
                }
            });
        } catch (error) {
            console.error('Failed to create models dir:', error);
        }

        return modelDir;
    }
}

export const storagePermissions = StoragePermissions;
