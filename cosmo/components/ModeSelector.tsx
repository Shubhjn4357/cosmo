/**
 * Mode Selector Component for Chat Header
 * Shows current mode and allows switching between modes
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, spacing, borderRadius } from '@/constants/theme';

export function ModeSelector() {
    const { theme } = useTheme();
    const [smartMode, setSmartMode] = useState(false);
    
    useEffect(() => {
        loadMode();
    }, []);
    
    const loadMode = async () => {
        const mode = await AsyncStorage.getItem('smartModeEnabled');
        setSmartMode(mode === 'true');
    };
    
    const getModeInfo = () => {
        if (smartMode) {
            return { icon: 'flash', label: 'Smart', color: '#10B981' };
        }
        return { icon: 'chatbubble', label: 'Normal', color: theme.colors.textMuted };
    };
    
    const mode = getModeInfo();
    
    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surfaceLight }]}>
            <Ionicons name={mode.icon as any} size={14} color={mode.color} />
            <Text style={[styles.label, { color: mode.color }]}>{mode.label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: borderRadius.full,
        gap: 4,
    },
    label: {
        fontSize: 12,
        fontWeight: '600',
    },
});
