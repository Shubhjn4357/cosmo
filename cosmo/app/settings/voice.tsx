/**
 * Voice Settings Screen
 * Configure TTS voice type and pitch
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Slider from '@react-native-community/slider';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';
import { ttsService, VoiceType, TTSSettings } from '@/services/ttsService';

export default function VoiceSettingsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [settings, setSettings] = useState<TTSSettings>(ttsService.getSettings());
  const [isTesting, setIsTesting] = useState(false);

  const updateVoice = async (voice: VoiceType) => {
    const newSettings = { ...settings, voice };
    setSettings(newSettings);
    await ttsService.saveSettings(newSettings);
  };

  const updatePitch = async (pitch: number) => {
    const newSettings = { ...settings, pitch };
    setSettings(newSettings);
    await ttsService.saveSettings(newSettings);
  };

  const testVoice = async () => {
    if (isTesting) return;

    setIsTesting(true);
    try {
      await ttsService.speak(
        'Hello! This is a test of the text to speech system. How does it sound?'
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to test voice. Please try again.');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
          Voice Settings
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Voice Type */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            Voice Type
          </Text>
          <Text style={[styles.sectionDesc, { color: theme.colors.textMuted }]}>
            Choose between male and female voice
          </Text>

          <View style={styles.voiceOptions}>
            <TouchableOpacity
              style={[
                styles.voiceOption,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor:
                    settings.voice === 'male' ? theme.colors.primary : 'transparent',
                },
              ]}
              onPress={() => updateVoice('male')}
            >
              <Ionicons
                name={settings.voice === 'male' ? 'radio-button-on' : 'radio-button-off'}
                size={24}
                color={settings.voice === 'male' ? theme.colors.primary : theme.colors.textMuted}
              />
              <View style={styles.voiceInfo}>
                <Text style={[styles.voiceLabel, { color: theme.colors.text }]}>
                  Male Voice
                </Text>
                <Text style={[styles.voiceSubtext, { color: theme.colors.textMuted }]}>
                  Deeper, masculine tone
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.voiceOption,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor:
                    settings.voice === 'female' ? theme.colors.primary : 'transparent',
                },
              ]}
              onPress={() => updateVoice('female')}
            >
              <Ionicons
                name={settings.voice === 'female' ? 'radio-button-on' : 'radio-button-off'}
                size={24}
                color={settings.voice === 'female' ? theme.colors.primary : theme.colors.textMuted}
              />
              <View style={styles.voiceInfo}>
                <Text style={[styles.voiceLabel, { color: theme.colors.text }]}>
                  Female Voice
                </Text>
                <Text style={[styles.voiceSubtext, { color: theme.colors.textMuted }]}>
                  Higher, feminine tone
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Pitch Control */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            Voice Pitch
          </Text>
          <Text style={[styles.sectionDesc, { color: theme.colors.textMuted }]}>
            Adjust the pitch of the voice ({settings.pitch.toFixed(1)}x)
          </Text>

          <View style={[styles.pitchControl, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.pitchLabels}>
              <Text style={[styles.pitchLabel, { color: theme.colors.textMuted }]}>
                Lower
              </Text>
              <Text style={[styles.pitchValue, { color: theme.colors.primary }]}>
                {settings.pitch.toFixed(1)}x
              </Text>
              <Text style={[styles.pitchLabel, { color: theme.colors.textMuted }]}>
                Higher
              </Text>
            </View>

            <Slider
              style={styles.slider}
              minimumValue={0.5}
              maximumValue={2.0}
              step={0.1}
              value={settings.pitch}
              onValueChange={updatePitch}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.textMuted + '40'}
              thumbTintColor={theme.colors.primary}
            />
          </View>
        </View>

        {/* Test Voice */}
        <TouchableOpacity
          style={[
            styles.testButton,
            {
              backgroundColor: theme.colors.primary,
              opacity: isTesting ? 0.6 : 1,
            },
          ]}
          onPress={testVoice}
          disabled={isTesting}
        >
          <Ionicons name="volume-high" size={24} color="#fff" />
          <Text style={styles.testButtonText}>
            {isTesting ? 'Playing...' : 'Test Voice'}
          </Text>
        </TouchableOpacity>

        {/* Info */}
        <View style={[styles.infoBox, { backgroundColor: theme.colors.surface }]}>
          <Ionicons name="information-circle" size={20} color={theme.colors.primary} />
          <Text style={[styles.infoText, { color: theme.colors.textMuted }]}>
            Voice settings apply to all text-to-speech playback in the app
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  sectionDesc: {
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  voiceOptions: {
    gap: spacing.md,
  },
  voiceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    gap: spacing.md,
  },
  voiceInfo: {
    flex: 1,
  },
  voiceLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: 2,
  },
  voiceSubtext: {
    fontSize: fontSize.xs,
  },
  pitchControl: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
  },
  pitchLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  pitchLabel: {
    fontSize: fontSize.sm,
  },
  pitchValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  testButtonText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  infoText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
});
