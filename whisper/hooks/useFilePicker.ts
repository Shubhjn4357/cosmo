/**
 * Whisper App - useFilePicker Hook
 * Handles file picking, camera capture, and modal state
 */

import { useState, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { SelectedFile, FileTypeOption } from '@/types';

interface UseFilePickerReturn {
    selectedFile: SelectedFile | null;
    showFileModal: boolean;
    fileTypeOptions: FileTypeOption[];
    setShowFileModal: (show: boolean) => void;
    setSelectedFile: (file: SelectedFile | null) => void;
    pickFile: (types: string[]) => Promise<void>;
    pickFromCamera: () => Promise<void>;
    pickFromGallery: () => Promise<void>;
    formatFileSize: (bytes?: number) => string;
}

export function useFilePicker(): UseFilePickerReturn {
    const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
    const [showFileModal, setShowFileModal] = useState(false);

    const fileTypeOptions: FileTypeOption[] = [
        { label: 'Camera', icon: 'camera', types: ['camera'] },
        { label: 'Gallery', icon: 'images', types: ['gallery'] },
        { label: 'Document', icon: 'document-text', types: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'] },
        { label: 'Image', icon: 'image', types: ['image/*'] },
        { label: 'JSON / Data', icon: 'code-slash', types: ['application/json', 'text/csv', 'application/xml'] },
        { label: 'Other', icon: 'folder-open', types: ['*/*'] },
    ];

    const pickFromCamera = useCallback(async () => {
        try {
            // Request camera permission
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
                console.error('Camera permission denied');
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                quality: 0.8,
            });

            if (!result.canceled && result.assets?.[0]) {
                const asset = result.assets[0];
                const fileName = `camera_${Date.now()}.jpg`;
                setSelectedFile({
                    uri: asset.uri,
                    name: fileName,
                    type: 'image/jpeg',
                    size: asset.fileSize,
                });
            }
        } catch (error) {
            console.error('Camera capture error:', error);
        } finally {
            setShowFileModal(false);
        }
    }, []);

    const pickFromGallery = useCallback(async () => {
        try {
            // Request media library permission
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                console.error('Gallery permission denied');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                quality: 0.8,
            });

            if (!result.canceled && result.assets?.[0]) {
                const asset = result.assets[0];
                const fileName = asset.fileName || `image_${Date.now()}.jpg`;
                setSelectedFile({
                    uri: asset.uri,
                    name: fileName,
                    type: asset.mimeType || 'image/jpeg',
                    size: asset.fileSize,
                });
            }
        } catch (error) {
            console.error('Gallery pick error:', error);
        } finally {
            setShowFileModal(false);
        }
    }, []);

    const pickFile = useCallback(async (types: string[]) => {
        // Handle special types
        if (types.includes('camera')) {
            await pickFromCamera();
            return;
        }
        if (types.includes('gallery')) {
            await pickFromGallery();
            return;
        }

        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: types,
                copyToCacheDirectory: true,
            });
            
            if (!result.canceled && result.assets?.[0]) {
                const asset = result.assets[0];
                setSelectedFile({
                    uri: asset.uri,
                    name: asset.name,
                    type: asset.mimeType,
                    size: asset.size,
                });
            }
        } catch (error) {
            console.error('File pick error:', error);
        } finally {
            setShowFileModal(false);
        }
    }, [pickFromCamera, pickFromGallery]);

    const formatFileSize = useCallback((bytes?: number): string => {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    }, []);

    return {
        selectedFile,
        showFileModal,
        fileTypeOptions,
        setShowFileModal,
        setSelectedFile,
        pickFile,
        pickFromCamera,
        pickFromGallery,
        formatFileSize,
    };
}

export default useFilePicker;
