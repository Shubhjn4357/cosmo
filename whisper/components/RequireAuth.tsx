/**
 * Require Auth Component
 * Guards protected routes - shows login prompt if not authenticated
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useGuest } from '@/hooks/useGuest';
import { useTheme } from '@/constants/theme';

interface RequireAuthProps {
  children: React.ReactNode;
  message?: string;
  showGuestInfo?: boolean;
}

export function RequireAuth({ 
  children, 
  message = "Please sign in to access this feature",
  showGuestInfo = true 
}: RequireAuthProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const { tokens: guestTokens } = useGuest();
  const router = useRouter();
  const { theme } = useTheme();

  // Show loading while checking auth
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.loadingContent}>
          <Ionicons name="hourglass-outline" size={48} color={theme.colors.textMuted} />
          <Text style={[styles.loadingText, { color: theme.colors.textMuted }]}>
            Loading...
          </Text>
        </View>
      </View>
    );
  }

  // If authenticated, show content
  if (isAuthenticated) {
    return <>{children}</>;
  }

  // Not authenticated - show login prompt
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '15' }]}>
          <Ionicons name="lock-closed" size={48} color={theme.colors.primary} />
        </View>

        {/* Message */}
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Authentication Required
        </Text>
        <Text style={[styles.message, { color: theme.colors.textMuted }]}>
          {message}
        </Text>

        {/* Guest Info */}
        {showGuestInfo && (
          <View style={[styles.guestInfo, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
            <Ionicons name="information-circle" size={20} color={theme.colors.accent} />
            <Text style={[styles.guestText, { color: theme.colors.text }]}>
              Guest mode: {guestTokens}/5 tokens remaining
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryButton, {backgroundColor: theme.colors.primary }]}
            onPress={() => router.push('/auth/login')}
          >
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: theme.colors.surfaceBorder }]}
            onPress={() => router.push('/auth/signup')}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>
              Create Account
            </Text>
          </TouchableOpacity>
        </View>

        {/* Skip button */}
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[styles.skipText, { color: theme.colors.textMuted }]}>
            Go Back
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  guestInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 32,
    width: '100%',
  },
  guestText: {
    fontSize: 14,
    flex: 1,
  },
  actions: {
    width: '100%',
    gap: 12,
    marginBottom: 16,
  },
  primaryButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  skipText: {
    fontSize: 14,
    marginTop: 8,
  },
});
