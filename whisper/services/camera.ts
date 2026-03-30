/**
 * Whisper App - Camera & Image Picker Service
 * Handles camera capture and gallery selection
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { Alert, Platform } from 'react-native';

export interface ImageResult {
    uri: string;
    base64?: string;
    width: number;
    height: number;
    type: 'image' | 'video';
    fileName: string;
    fileSize?: number;
}

export interface CameraOptions {
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    includeBase64?: boolean;
    aspect?: [number, number];
    allowsEditing?: boolean;
}

const DEFAULT_OPTIONS: CameraOptions = {
    quality: 0.8,
    maxWidth: 1920,
    maxHeight: 1920,
    includeBase64: true,
    allowsEditing: true,
};

/**
 * Request camera permissions
 */
export async function requestCameraPermission(): Promise<boolean> {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status !== 'granted') {
        Alert.alert(
            'Camera Permission Required',
            'Please enable camera access in your device settings to take photos.',
            [{ text: 'OK' }]
        );
        return false;
    }

    return true;
}

/**
 * Request media library permissions
 */
export async function requestMediaLibraryPermission(): Promise<boolean> {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== 'granted') {
        Alert.alert(
            'Gallery Permission Required',
            'Please enable photo library access in your device settings to select images.',
            [{ text: 'OK' }]
        );
        return false;
    }

    return true;
}

/**
 * Compress and resize image
 */
async function processImage(
    uri: string,
    options: CameraOptions
): Promise<{ uri: string; base64?: string; width: number; height: number }> {
    const actions: ImageManipulator.Action[] = [];

    // Add resize action if needed
    if (options.maxWidth || options.maxHeight) {
        actions.push({
            resize: {
                width: options.maxWidth,
                height: options.maxHeight,
            },
        });
    }

    const result = await ImageManipulator.manipulateAsync(
        uri,
        actions,
        {
            compress: options.quality || 0.8,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: options.includeBase64,
        }
    );

    return {
        uri: result.uri,
        base64: result.base64,
        width: result.width,
        height: result.height,
    };
}

/**
 * Take a photo with camera
 */
export async function takePhoto(options: CameraOptions = {}): Promise<ImageResult | null> {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return null;

    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: opts.allowsEditing,
            aspect: opts.aspect,
            quality: opts.quality,
        });

        if (result.canceled || !result.assets?.[0]) {
            return null;
        }

        const asset = result.assets[0];

        // Process image (compress/resize)
        const processed = await processImage(asset.uri, opts);

        // Get file info
        const fileInfo = await FileSystem.getInfoAsync(processed.uri);

        return {
            uri: processed.uri,
            base64: processed.base64,
            width: processed.width,
            height: processed.height,
            type: 'image',
            fileName: asset.fileName || `photo_${Date.now()}.jpg`,
            fileSize: fileInfo.exists ? fileInfo.size : undefined,
        };
    } catch (error) {
        console.error('Error taking photo:', error);
        Alert.alert('Error', 'Failed to capture photo. Please try again.');
        return null;
    }
}

/**
 * Pick image from gallery
 */
export async function pickFromGallery(options: CameraOptions = {}): Promise<ImageResult | null> {
    const hasPermission = await requestMediaLibraryPermission();
    if (!hasPermission) return null;

    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: opts.allowsEditing,
            aspect: opts.aspect,
            quality: opts.quality,
        });

        if (result.canceled || !result.assets?.[0]) {
            return null;
        }

        const asset = result.assets[0];

        // Process image (compress/resize)
        const processed = await processImage(asset.uri, opts);

        // Get file info
        const fileInfo = await FileSystem.getInfoAsync(processed.uri);

        return {
            uri: processed.uri,
            base64: processed.base64,
            width: processed.width,
            height: processed.height,
            type: 'image',
            fileName: asset.fileName || `image_${Date.now()}.jpg`,
            fileSize: fileInfo.exists ? fileInfo.size : undefined,
        };
    } catch (error) {
        console.error('Error picking image:', error);
        Alert.alert('Error', 'Failed to select image. Please try again.');
        return null;
    }
}

/**
 * Show image source picker (camera or gallery)
 */
export async function pickImage(options: CameraOptions = {}): Promise<ImageResult | null> {
    return new Promise((resolve) => {
        Alert.alert(
            'Select Image',
            'Choose an image source',
            [
                {
                    text: 'Camera',
                    onPress: async () => {
                        const result = await takePhoto(options);
                        resolve(result);
                    },
                },
                {
                    text: 'Gallery',
                    onPress: async () => {
                        const result = await pickFromGallery(options);
                        resolve(result);
                    },
                },
                {
                    text: 'Cancel',
                    style: 'cancel',
                    onPress: () => resolve(null),
                },
            ],
            { cancelable: true }
        );
    });
}

/**
 * Convert image to base64 for API upload
 */
export async function imageToBase64(uri: string): Promise<string | null> {
    try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: 'base64',
        });
        return base64;
    } catch (error) {
        console.error('Error converting image to base64:', error);
        return null;
    }
}

/**
 * Get file size in human readable format
 */
export function formatFileSize(bytes?: number): string {
    if (!bytes) return 'Unknown';

    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}
