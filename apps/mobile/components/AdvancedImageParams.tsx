/**
 * Advanced Image Parameters Component
 * Collapsible panel for fine-tuning image generation
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, borderRadius, fontSize } from '@/constants/theme';

export interface AdvancedImageParams {
  temperature: number;
  seed: number;
  steps: number;
  cfgScale: number;
  negativePrompt: string;
  width: number;
  height: number;
  enhancePrompt: boolean;
}

interface AdvancedImageParamsProps {
  params: AdvancedImageParams;
  onChange: (params: Partial<AdvancedImageParams>) => void;
  visible: boolean;
  onToggle: () => void;
}

export function AdvancedImageParams({
  params,
  onChange,
  visible,
  onToggle,
}: AdvancedImageParamsProps) {
  const { theme } = useTheme();

  const dimensionOptions = [
    { label: '512x512', width: 512, height: 512 },
    { label: '768x768', width: 768, height: 768 },
    { label: '1024x1024', width: 1024, height: 1024 },
    { label: '512x768', width: 512, height: 768 },
    { label: '768x512', width: 768, height: 512 },
  ];

  return (
    <View style={styles.container}>
      {/* Toggle Button */}
      <TouchableOpacity
        style={[styles.header, { backgroundColor: theme.colors.surface }]}
        onPress={onToggle}
      >
        <View style={styles.headerLeft}>
          <Ionicons
            name="settings"
            size={20}
            color={theme.colors.primary}
          />
          <Text style={[styles.headerText, { color: theme.colors.text }]}>
            Advanced Parameters
          </Text>
        </View>
        <Ionicons
          name={visible ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.colors.textMuted}
        />
      </TouchableOpacity>

      {/* Parameters Panel */}
      {visible && (
        <View style={[styles.panel, { backgroundColor: theme.colors.surface }]}>
          {/* Temperature */}
          <View style={styles.paramGroup}>
            <View style={styles.paramHeader}>
              <Text style={[styles.paramLabel, { color: theme.colors.text }]}>
                Temperature
              </Text>
              <Text style={[styles.paramValue, { color: theme.colors.primary }]}>
                {params.temperature.toFixed(1)}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0.1}
              maximumValue={2.0}
              step={0.1}
              value={params.temperature}
              onValueChange={(v: number) => onChange({ temperature: v })}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.textMuted + '40'}
            />
            <Text style={[styles.paramHint, { color: theme.colors.textMuted }]}>
              Lower = more predictable, Higher = more creative
            </Text>
          </View>

          {/* Seed */}
          <View style={styles.paramGroup}>
            <Text style={[styles.paramLabel, { color: theme.colors.text }]}>
              Seed
            </Text>
            <View style={styles.seedRow}>
              <TextInput
                style={[
                  styles.seedInput,
                  {
                    color: theme.colors.text,
                    backgroundColor: theme.colors.background,
                    borderColor: theme.colors.surfaceBorder,
                  },
                ]}
                value={params.seed.toString()}
                onChangeText={(v) => onChange({ seed: parseInt(v) || -1 })}
                keyboardType="numeric"
                placeholder="-1"
                placeholderTextColor={theme.colors.textMuted}
              />
              <TouchableOpacity
                style={[styles.randomButton, { backgroundColor: theme.colors.primary }]}
                onPress={() => onChange({ seed: -1 })}
              >
                <Ionicons name="shuffle" size={16} color="#fff" />
                <Text style={styles.randomButtonText}>Random</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.paramHint, { color: theme.colors.textMuted }]}>
              -1 for random, or set specific number for reproducibility
            </Text>
          </View>

          {/* Steps */}
          <View style={styles.paramGroup}>
            <View style={styles.paramHeader}>
              <Text style={[styles.paramLabel, { color: theme.colors.text }]}>
                Steps
              </Text>
              <Text style={[styles.paramValue, { color: theme.colors.primary }]}>
                {params.steps}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={4}
              maximumValue={50}
              step={1}
              value={params.steps}
              onValueChange={(v: number) => onChange({ steps: Math.round(v) })}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.textMuted + '40'}
            />
            <Text style={[styles.paramHint, { color: theme.colors.textMuted }]}>
              More steps = better quality but slower generation
            </Text>
          </View>

          {/* CFG Scale */}
          <View style={styles.paramGroup}>
            <View style={styles.paramHeader}>
              <Text style={[styles.paramLabel, { color: theme.colors.text }]}>
                CFG Scale
              </Text>
              <Text style={[styles.paramValue, { color: theme.colors.primary }]}>
                {params.cfgScale.toFixed(1)}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={20}
              step={0.5}
              value={params.cfgScale}
              onValueChange={(v: number) => onChange({ cfgScale: v })}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.textMuted + '40'}
            />
            <Text style={[styles.paramHint, { color: theme.colors.textMuted }]}>
              How closely to follow the prompt (7-11 recommended)
            </Text>
          </View>

          {/* Dimensions */}
          <View style={styles.paramGroup}>
            <Text style={[styles.paramLabel, { color: theme.colors.text }]}>
              Dimensions
            </Text>
            <View style={styles.dimensionsGrid}>
              {dimensionOptions.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.dimensionChip,
                    {
                      backgroundColor:
                        params.width === option.width && params.height === option.height
                          ? theme.colors.primary
                          : theme.colors.background,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                  onPress={() =>
                    onChange({ width: option.width, height: option.height })
                  }
                >
                  <Text
                    style={[
                      styles.dimensionText,
                      {
                        color:
                          params.width === option.width && params.height === option.height
                            ? '#fff'
                            : theme.colors.text,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Negative Prompt */}
          <View style={styles.paramGroup}>
            <Text style={[styles.paramLabel, { color: theme.colors.text }]}>
              Negative Prompt
            </Text>
            <TextInput
              style={[
                styles.textArea,
                {
                  color: theme.colors.text,
                  backgroundColor: theme.colors.background,
                  borderColor: theme.colors.surfaceBorder,
                },
              ]}
              value={params.negativePrompt}
              onChangeText={(v) => onChange({ negativePrompt: v })}
              placeholder="What to avoid (e.g., blurry, low quality)"
              placeholderTextColor={theme.colors.textMuted}
              multiline
              maxLength={200}
            />
          </View>

          {/* Prompt Enhancement Toggle */}
          <View style={[styles.paramGroup, styles.switchGroup]}>
            <View style={styles.switchLabel}>
              <Ionicons name="sparkles" size={20} color={theme.colors.primary} />
              <Text style={[styles.paramLabel, { color: theme.colors.text }]}>
                AI Prompt Enhancement
              </Text>
            </View>
            <Switch
              value={params.enhancePrompt}
              onValueChange={(v) => onChange({ enhancePrompt: v })}
              trackColor={{
                false: theme.colors.textMuted + '40',
                true: theme.colors.primary,
              }}
            />
          </View>
          <Text style={[styles.paramHint, { color: theme.colors.textMuted, marginTop: -spacing.sm }]}>
            Use AI to automatically improve your prompt
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  panel: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.lg,
  },
  paramGroup: {
    gap: spacing.xs,
  },
  paramHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paramLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  paramValue: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  paramHint: {
    fontSize: fontSize.xs,
    marginTop: -spacing.xs,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  seedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  seedInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: fontSize.md,
  },
  randomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  randomButtonText: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  dimensionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dimensionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  dimensionText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  textArea: {
    minHeight: 60,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: fontSize.sm,
    textAlignVertical: 'top',
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});

// Default parameters
export const defaultAdvancedParams: AdvancedImageParams = {
  temperature: 1.0,
  seed: -1,
  steps: 25,
  cfgScale: 7.5,
  negativePrompt: 'blurry, low quality, distorted, ugly, bad anatomy',
  width: 1024,
  height: 1024,
  enhancePrompt: false,
};
