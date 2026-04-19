/**
 * Cosmo App - Typing Animation Component
 * Gemini-style character-by-character text reveal animation
 */

import React, { useState, useEffect, useRef } from 'react';
import { Text, View, StyleSheet, Animated } from 'react-native';
import { useTheme, fontSize } from '@/constants/theme';

interface TypingAnimationProps {
    text: string;
    speed?: number; // ms per character
    onComplete?: () => void;
    style?: any;
}

export function TypingAnimation({ text, speed = 20, onComplete, style }: TypingAnimationProps) {
    const { theme } = useTheme();
    const [displayedText, setDisplayedText] = useState('');
    const indexRef = useRef(0);
    const cursorOpacity = useRef(new Animated.Value(1)).current;

    // Cursor blink animation
    useEffect(() => {
        const blink = Animated.loop(
            Animated.sequence([
                Animated.timing(cursorOpacity, {
                    toValue: 0,
                    duration: 500,
                    useNativeDriver: true,
                }),
                Animated.timing(cursorOpacity, {
                    toValue: 1,
                    duration: 500,
                    useNativeDriver: true,
                }),
            ])
        );
        blink.start();
        return () => blink.stop();
    }, []);

    // Typing effect
    useEffect(() => {
        if (!text) return;
        
        indexRef.current = 0;
        setDisplayedText('');

        const interval = setInterval(() => {
            if (indexRef.current < text.length) {
                setDisplayedText(text.slice(0, indexRef.current + 1));
                indexRef.current++;
            } else {
                clearInterval(interval);
                onComplete?.();
            }
        }, speed);

        return () => clearInterval(interval);
    }, [text, speed, onComplete]);

    const isComplete = displayedText.length === text.length;

    return (
        <View style={styles.container}>
            <Text style={[styles.text, { color: theme.colors.text }, style]}>
                {displayedText}
                {!isComplete && (
                    <Animated.Text style={[styles.cursor, { opacity: cursorOpacity, color: theme.colors.primary }]}>
                        |
                    </Animated.Text>
                )}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    text: {
        fontSize: fontSize.md,
        lineHeight: fontSize.md * 1.5,
    },
    cursor: {
        fontWeight: '300',
    },
});

export default TypingAnimation;
