/**
 * Data FeedDrawer
 * Upload files for AI training
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { Drawer } from './Drawer';
import { GlassButton } from '../Glass/GlassButton';
import { LoadingDots } from '../Animated/LoadingDots';
import { useM3Colors, M3_SPACING, M3_RADIUS } from '@/constants/material3';
import { cosmoAPI } from '@/services/api';

interface DataFeedDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export function DataFeedDrawer({
  visible,
  onClose,
}: DataFeedDrawerProps) {
  const m3Colors = useM3Colors();
  const [selectedFiles, setSelectedFiles] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');

  const pickFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets?.length) {
        setSelectedFiles(prev => [...prev, ...result.assets]);
      }
    } catch (error) {
      console.error('File picker error:', error);
    }
  };

  const uploadFiles = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setUploadStatus('Uploading files...');

   try {
     const baseUrl = cosmoAPI.getBaseUrl();
      const formData = new FormData();

      selectedFiles.forEach((file, index) => {
        formData.append('files', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'application/octet-stream',
        } as any);
      });

      formData.append('source', 'mobile_app');

      const response = await fetch(`${baseUrl}/api/feed/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const result = await response.json();

      if (result.success) {
        setUploadStatus(`✅ Uploaded ${result.processed} files for training!`);
        setSelectedFiles([]);
        setTimeout(() => {
          setUploadStatus('');
          onClose();
        }, 2000);
      } else {
        setUploadStatus('❌ Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus('❌ Upload error');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Drawer visible={visible} onClose={onClose} title="Feed Training Data">
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={[styles.description, { color: m3Colors.onSurfaceVariant }]}>
          Upload documents, images, or code to improve Cosmo's knowledge base
        </Text>

        {/* File Types */}
        <View style={styles.fileTypes}>
          <FileTypeChip icon="document-text" text="PDF, TXT" />
          <FileTypeChip icon="image" text="Images" />
          <FileTypeChip icon="code-slash" text="Code" />
        </View>

        {/* Selected Files */}
        {selectedFiles.length > 0 && (
          <View style={styles.filesContainer}>
            <Text style={[styles.sectionTitle, { color: m3Colors.onSurface }]}>
              Selected Files ({selectedFiles.length})
            </Text>
            {selectedFiles.map((file, index) => (
              <View key={index} style={[styles.fileItem, { borderColor: m3Colors.outlineVariant }]}>
                <Ionicons name="document" size={20} color={m3Colors.primary} />
                <Text style={[styles.fileName, { color: m3Colors.onSurface }]} numberOfLines={1}>
                  {file.name}
                </Text>
                <TouchableOpacity
                  onPress={() => setSelectedFiles(prev => prev.filter((_, i) => i !== index))}
                >
                  <Ionicons name="close-circle" size={20} color={m3Colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Upload Status */}
        {uploadStatus && (
          <Text style={[styles.status, {  color: m3Colors.primary }]}>
            {uploadStatus}
          </Text>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <GlassButton
            title="Pick Files"
            onPress={pickFiles}
            variant="medium"
            icon={<Ionicons name="folder-open" size={20} color={m3Colors.primary} />}
          />
          
          {selectedFiles.length > 0 && (
            <GlassButton
              title={isUploading ? 'Uploading...' : 'Upload & Train'}
              onPress={uploadFiles}
              variant="accent"
              disabled={isUploading}
              icon={isUploading ? <LoadingDots size={6} /> : <Ionicons name="cloud-upload" size={20} color="#fff" />}
            />
          )}
        </View>
      </ScrollView>
    </Drawer>
  );
}

function FileTypeChip({ icon, text }: { icon: string; text: string }) {
  const m3Colors = useM3Colors();
  return (
    <View style={[styles.chip, { backgroundColor: m3Colors.surfaceContainer }]}>
      <Ionicons name={icon as any} size={16} color={m3Colors.primary} />
      <Text style={[styles.chipText, { color: m3Colors.onSurface }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: M3_SPACING.lg,
  },
  fileTypes: {
    flexDirection: 'row',
    gap: M3_SPACING.sm,
    marginBottom: M3_SPACING.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: M3_SPACING.xs,
    paddingHorizontal: M3_SPACING.md,
    paddingVertical: M3_SPACING.sm,
    borderRadius: M3_RADIUS.md,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  filesContainer: {
    marginBottom: M3_SPACING.lg,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: M3_SPACING.sm,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: M3_SPACING.sm,
    padding: M3_SPACING.md,
    borderWidth: 1,
    borderRadius: M3_RADIUS.md,
    marginBottom: M3_SPACING.sm,
  },
  fileName: {
    flex: 1,
    fontSize: 14,
  },
  status: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginVertical: M3_SPACING.md,
  },
  actions: {
    gap: M3_SPACING.md,
    marginTop: M3_SPACING.lg,
    marginBottom: M3_SPACING.lg,
  },
});

export default DataFeedDrawer;
