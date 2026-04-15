/**
 * Base Drawer Component
 * Bottom drawer with glass effect and bouncy animations
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useM3Colors, M3_RADIUS, M3_SPACING, createGlassStyle } from '@/constants/material3';
import { SPRING_CONFIGS } from '@/constants/animations';
import { useTheme } from '@/constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface DrawerProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  height?: number;
}

export function Drawer({
  visible,
  onClose,
  title,
  children,
  height = SCREEN_HEIGHT * 0.7,
}: DrawerProps) {
  const { isDark } = useTheme();
  const m3Colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const glassStyle = createGlassStyle('heavy', isDark);
  
  const translateY = useSharedValue(height);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0, SPRING_CONFIGS.bouncy);
    } else {
      opacity.value = withTiming(0, { duration: 150 });
      translateY.value = withTiming(height, { duration: 250 });
    }
  }, [visible, height]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Overlay */}
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.overlay, overlayStyle]} />
        </TouchableWithoutFeedback>

        {/* Drawer */}
        <Animated.View
          style={[
            styles.drawer,
            {
              height,
              paddingBottom: insets.bottom,
            },
            drawerStyle,
          ]}
        >
          <BlurView
            intensity={30}
            tint={isDark ? 'dark' : 'light'}
            style={[styles.drawerContent, glassStyle]}
          >
            {/* Handle */}
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: m3Colors.onSurfaceVariant }]} />
            </View>

            {/* Header */}
            {title && (
              <View style={styles.header}>
                <Text style={[styles.title, { color: m3Colors.onSurface }]}>
                  {title}
                </Text>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color={m3Colors.onSurfaceVariant} />
                </TouchableOpacity>
              </View>
            )}

            {/* Content */}
            <View style={styles.content}>
              {children}
            </View>
          </BlurView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawer: {
    borderTopLeftRadius: M3_RADIUS.xxl,
    borderTopRightRadius: M3_RADIUS.xxl,
    overflow: 'hidden',
  },
  drawerContent: {
    flex: 1,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: M3_SPACING.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: M3_SPACING.lg,
    paddingBottom: M3_SPACING.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeButton: {
    padding: M3_SPACING.xs,
  },
  content: {
    flex: 1,
    paddingHorizontal: M3_SPACING.lg,
  },
});

export default Drawer;
