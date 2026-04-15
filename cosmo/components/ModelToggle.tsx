/**
 * Helper: Local/Cloud Model Toggle Component
 * Shows switch to select FREE local or paid cloud models
 */

import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/theme';

interface ModelToggleProps {
  isLocal: boolean;
  onToggle: (value: boolean) => void;
  tokenCost?: number;
}

export function ModelToggle({ isLocal, onToggle, tokenCost = 0.1 }: ModelToggleProps) {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
      <View style={styles.option}>
        <Ionicons 
          name={isLocal ? "phone-portrait" : "phone-portrait-outline"} 
          size={18} 
          color={isLocal ? theme.colors.success : theme.colors.textMuted} 
        />
        <View style={styles.optionInfo}>
          <Text style={[styles.optionLabel, { color: isLocal ? theme.colors.success : theme.colors.textMuted }]}>
            Local
          </Text>
          <Text style={[styles.optionHint, { color: theme.colors.textMuted }]}>
            FREE
          </Text>
        </View>
      </View>

      <Switch
        value={!isLocal}
        onValueChange={(cloud) => onToggle(!cloud)}
        trackColor={{ false: theme.colors.success + '40', true: theme.colors.primary + '40' }}
        thumbColor={!isLocal ? theme.colors.success : theme.colors.primary}
      />

      <View style={styles.option}>
        <Ionicons 
          name={!isLocal ? "cloud" : "cloud-outline"} 
          size={18} 
          color={!isLocal ? theme.colors.primary : theme.colors.textMuted} 
        />
        <View style={styles.optionInfo}>
          <Text style={[styles.optionLabel, { color: !isLocal ? theme.colors.primary : theme.colors.textMuted }]}>
            Cloud
          </Text>
          <Text style={[styles.optionHint, { color: theme.colors.textMuted }]}>
            {tokenCost} tokens
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  optionInfo: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  optionHint: {
    fontSize: 11,
    marginTop: 2,
  },
});
