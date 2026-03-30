/**
 * Subscription Drawer
 * Pro subscription UI with pricing and features
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Drawer } from './Drawer';
import { GlassButton } from '../Glass/GlassButton';
import { useM3Colors, M3_SPACING, M3_RADIUS } from '@/constants/material3';
import { IS_DEV_MODE } from '@/services/SubscriptionManager';

interface SubscriptionDrawerProps {
  visible: boolean;
  onClose: () => void;
  onSubscribe: () => void;
}

const PRO_FEATURES = [
  { icon: 'flash', text: 'HuggingFace API Access (FLUX + Mistral)' },
  { icon: 'infinite', text: 'Unlimited AI Generations' },
  { icon: 'sparkles', text: 'Advanced Personalities (22 total)' },
  { icon: 'rocket', text: 'Priority Processing' },
  { icon: 'cloud-upload', text: 'Unlimited Data Feed Uploads' },
  { icon: 'shield-checkmark', text: 'No Ads' },
];

export function SubscriptionDrawer({
  visible,
  onClose,
  onSubscribe,
}: SubscriptionDrawerProps) {
  const m3Colors = useM3Colors();

  return (
    <Drawer visible={visible} onClose={onClose} title="Whisper AI Pro">
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Pricing */}
        <View style={styles.pricingCard}>
          <Text style={[styles.price, { color: m3Colors.primary }]}>
            ₹99
            <Text style={[styles.period, { color: m3Colors.onSurfaceVariant }]}>
              /month
            </Text>
          </Text>
          <Text style={[styles.subtitle, { color: m3Colors.onSurfaceVariant }]}>
            Unlock the full power of Whisper AI
          </Text>
        </View>

        {/* Features */}
        <View style={styles.featuresContainer}>
          {PRO_FEATURES.map((feature, index) => (
            <View key={index} style={styles.featureRow}>
              <View style={[styles.iconCircle, { backgroundColor: m3Colors.primaryContainer }]}>
                <Ionicons
                  name={feature.icon as any}
                  size={20}
                  color={m3Colors.primary}
                />
              </View>
              <Text style={[styles.featureText, { color: m3Colors.onSurface }]}>
                {feature.text}
              </Text>
            </View>
          ))}
        </View>

        {/* Subscribe Button */}
        <GlassButton
          title="Subscribe Now"
          onPress={() => {
            onSubscribe();
            onClose();
          }}
          variant="accent"
          style={styles.subscribeButton}
        />

        {/* Terms */}
        <Text style={[styles.terms, { color: m3Colors.onSurfaceVariant }]}>
          Cancel anytime. Terms and conditions apply.
        </Text>
      </ScrollView>
    </Drawer>
  );
}

const styles = StyleSheet.create({
  pricingCard: {
    alignItems: 'center',
    paddingVertical: M3_SPACING.xl,
  },
  price: {
    fontSize: 48,
    fontWeight: '800',
  },
  period: {
    fontSize: 18,
    fontWeight: '400',
  },
  subtitle: {
    fontSize: 14,
    marginTop: M3_SPACING.xs,
  },
  featuresContainer: {
    paddingVertical: M3_SPACING.lg,
    gap: M3_SPACING.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: M3_SPACING.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  subscribeButton: {
    marginTop: M3_SPACING.lg,
    marginBottom: M3_SPACING.md,
  },
  terms: {
    fontSize: 12,
    textAlign: 'center',
    paddingBottom: M3_SPACING.lg,
  },
});

export default SubscriptionDrawer;
