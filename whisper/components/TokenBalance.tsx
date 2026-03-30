/**
 * Token Balance Component
 * Displays user's remaining tokens or guest tokens
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useGuest } from '@/hooks/useGuest';
import { useRouter } from 'expo-router';

export function TokenBalance() {
  const { user, profile } = useAuth();
  const { tokens: guestTokens } = useGuest();
  const router = useRouter();

  // Logged in users
  if (user && profile) {
    const tokensUsed = profile.tokens_used || 0;
    const tokensLimit = profile.tokens_limit || 20;
    const remaining = tokensLimit - tokensUsed;
    const percentage = (remaining / tokensLimit) * 100;
    const tier = profile.subscription_tier || 'free';

    const getColor = () => {
      if (percentage > 50) return '#10b981'; // green
      if (percentage > 20) return '#f59e0b'; // yellow
      return '#ef4444'; // red
    };

    return (
      <TouchableOpacity 
        style={styles.container}
        onPress={() => router.push('/subscription')}
      >
        <View style={styles.iconContainer}>
          <Ionicons name="flash" size={16} color={getColor()} />
        </View>
        <Text style={styles.tokenText}>
          {remaining.toFixed(1)}/{tokensLimit}
        </Text>
        {tier === 'free' && remaining < 5 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>↑ PRO</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  // Guest users
  return (
    <TouchableOpacity 
      style={styles.container}
      onPress={() => router.push('/auth/signup')}
    >
      <View style={styles.iconContainer}>
        <Ionicons 
          name="flash" 
          size={16} 
          color={guestTokens > 0 ? '#3b82f6' : '#ef4444'} 
        />
      </View>
      <Text style={styles.tokenText}>
        {guestTokens}/5 (Guest)
      </Text>
      {guestTokens < 2 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Sign up</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  iconContainer: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tokenText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
