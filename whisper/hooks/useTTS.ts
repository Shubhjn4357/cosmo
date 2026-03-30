/**
 * Whisper App - useTTS Hook
 * Text-to-Speech functionality for AI responses
 */

import { useState, useCallback, useRef } from 'react';
import * as Speech from 'expo-speech';

interface UseTTSReturn {
    isSpeaking: boolean;
    speak: (text: string) => void;
    stop: () => void;
    toggleSpeech: (text: string) => void;
}

export function useTTS(): UseTTSReturn {
    const [isSpeaking, setIsSpeaking] = useState(false);
    const currentTextRef = useRef<string>('');

    const speak = useCallback((text: string) => {
        // Stop any current speech
        Speech.stop();
        currentTextRef.current = text;
        setIsSpeaking(true);

        Speech.speak(text, {
            language: 'en-US',
            pitch: 1.0,
            rate: 0.9,
            onDone: () => setIsSpeaking(false),
            onError: () => setIsSpeaking(false),
            onStopped: () => setIsSpeaking(false),
        });
    }, []);

    const stop = useCallback(() => {
        Speech.stop();
        setIsSpeaking(false);
    }, []);

    const toggleSpeech = useCallback((text: string) => {
        if (isSpeaking && currentTextRef.current === text) {
            stop();
        } else {
            speak(text);
        }
    }, [isSpeaking, speak, stop]);

    return {
        isSpeaking,
        speak,
        stop,
        toggleSpeech,
    };
}

export default useTTS;
