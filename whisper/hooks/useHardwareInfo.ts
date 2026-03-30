/**
 * Whisper App - useHardwareInfo Hook
 * Checks device capabilities for model compatibility
 */

import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';

export interface HardwareInfo {
    totalMemory: number | null;  // in bytes
    deviceName: string;
    manufacturer: string | null;
    modelName: string | null;
    osVersion: string | null;
    isDevice: boolean;
    memoryGB: number;
}

export type CompatibilityLevel = 'excellent' | 'good' | 'limited' | 'incompatible';

export interface ModelCompatibility {
    level: CompatibilityLevel;
    color: string;
    canRun: boolean;
    recommendedQuantization: string;
    warning?: string;
}

export function useHardwareInfo() {
    const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo>({
        totalMemory: null,
        deviceName: Device.deviceName || 'Unknown',
        manufacturer: Device.manufacturer,
        modelName: Device.modelName,
        osVersion: Device.osVersion,
        isDevice: Device.isDevice,
        memoryGB: 0,
    });

    useEffect(() => {
        async function getDeviceInfo() {
            try {
                // expo-device provides totalMemory in bytes (may be null on some platforms)
                const totalMemory = Device.totalMemory;
                const memoryGB = totalMemory ? totalMemory / (1024 * 1024 * 1024) : 0;
                
                setHardwareInfo(prev => ({
                    ...prev,
                    totalMemory,
                    memoryGB: Math.round(memoryGB * 10) / 10,
                }));
            } catch (error) {
                console.error('Failed to get device info:', error);
            }
        }

        getDeviceInfo();
    }, []);

    // Check compatibility for a model based on RAM requirements
    const checkModelCompatibility = (modelSizeGB: number): ModelCompatibility => {
        const { memoryGB, isDevice } = hardwareInfo;

        // Simulator/emulator - always compatible for testing
        if (!isDevice) {
            return {
                level: 'good',
                color: '#22C55E',
                canRun: true,
                recommendedQuantization: 'Q4_K_M',
                warning: 'Running on simulator/emulator',
            };
        }

        // No memory info available
        if (memoryGB === 0) {
            return {
                level: 'limited',
                color: '#F59E0B',
                canRun: true,
                recommendedQuantization: 'Q4_0',
                warning: 'Unable to detect RAM',
            };
        }

        // Calculate required RAM (model + overhead)
        const requiredRAM = modelSizeGB * 1.5; // 50% overhead

        if (memoryGB >= requiredRAM * 2) {
            // Excellent: Has 2x the required RAM
            return {
                level: 'excellent',
                color: '#22C55E',
                canRun: true,
                recommendedQuantization: 'Q8_0',
            };
        } else if (memoryGB >= requiredRAM) {
            // Good: Has enough RAM
            return {
                level: 'good',
                color: '#22C55E',
                canRun: true,
                recommendedQuantization: 'Q4_K_M',
            };
        } else if (memoryGB >= requiredRAM * 0.6) {
            // Limited: Might work with lower quantization
            return {
                level: 'limited',
                color: '#F59E0B',
                canRun: true,
                recommendedQuantization: 'Q4_0',
                warning: 'May be slow on this device',
            };
        } else {
            // Incompatible: Not enough RAM
            return {
                level: 'incompatible',
                color: '#EF4444',
                canRun: false,
                recommendedQuantization: 'N/A',
                warning: 'Insufficient RAM for this model',
            };
        }
    };

    return {
        hardwareInfo,
        checkModelCompatibility,
    };
}

export default useHardwareInfo;
