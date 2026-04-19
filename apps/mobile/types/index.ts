import { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as SharedTypes from '@cosmo/types';
import * as SharedConstants from '@cosmo/constants';

// Re-export shared types
export * from '@cosmo/types';

// Utility types specific to mobile
export type IconName = ComponentProps<typeof Ionicons>['name'];

export interface FormDataValue {
    uri: string;
    name: string;
    type: string;
}

// File types
export interface SelectedFile {
    uri: string;
    name: string;
    type?: string;
    size?: number;
}

export interface FileTypeOption {
    label: string;
    icon: string;
    types: string[];
}

// Settings types
export interface AppSettings {
    enterToSend: boolean;
    useRag: boolean;
    serverUrl: string;
    modelSwitchEnabled: boolean;
}

// Re-export constants as they were (bridge)
export const DEFAULT_AI_RUNTIME = SharedConstants.DEFAULT_AI_RUNTIME;
export const MODEL_MODE_SEQUENCE = SharedConstants.MODEL_MODE_SEQUENCE;
export const MODEL_MODE_LABELS = SharedConstants.MODEL_MODE_LABELS;
export const MODEL_MODE_DESCRIPTIONS = SharedConstants.MODEL_MODE_DESCRIPTIONS;
export const DEFAULT_PERSONALITY = SharedConstants.DEFAULT_PERSONALITY;
export const PERSONALITY_PRESETS = SharedConstants.PERSONALITY_PRESETS;

export type CharacterAction = {
    emoji: string;
    label: string;
};
