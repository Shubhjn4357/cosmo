/**
 * Cosmo App - Hardware Compatibility Checker
 * Detects device capabilities and compares with model requirements
 */

import * as Device from 'expo-device';
import { Platform } from 'react-native';

export interface DeviceInfo {
    brand: string | null;
    modelName: string | null;
    osName: string;
    osVersion: string | null;
    deviceType: string;
    totalMemoryMB: number;
    isDevice: boolean;
}

export interface CompatibilityResult {
    modelId: string;
    modelName: string;
    compatible: boolean;
    level: 'excellent' | 'good' | 'marginal' | 'incompatible';
    reason: string;
    ramRequired: number;
    ramAvailable: number;
}

// Get device information
export async function getDeviceInfo(): Promise<DeviceInfo> {
    // Estimate RAM based on device type (expo-device doesn't provide RAM directly)
    let estimatedRAM = 4096; // Default 4GB
    
    if (Platform.OS === 'ios') {
        // Estimate based on iOS device
        estimatedRAM = 4096; // Most modern iOS devices have 4GB+
    } else if (Platform.OS === 'android') {
        // Android - try to estimate from device year/model
        estimatedRAM = 4096; // Conservative estimate
    } else {
        // Web - assume desktop with 8GB+
        estimatedRAM = 8192;
    }

    return {
        brand: Device.brand,
        modelName: Device.modelName,
        osName: Device.osName || Platform.OS,
        osVersion: Device.osVersion,
        deviceType: getDeviceTypeName(Device.deviceType),
        totalMemoryMB: estimatedRAM,
        isDevice: Device.isDevice,
    };
}

function getDeviceTypeName(type: Device.DeviceType | null): string {
    switch (type) {
        case Device.DeviceType.PHONE:
            return 'Phone';
        case Device.DeviceType.TABLET:
            return 'Tablet';
        case Device.DeviceType.DESKTOP:
            return 'Desktop';
        case Device.DeviceType.TV:
            return 'TV';
        default:
            return 'Unknown';
    }
}

/**
 * Check compatibility for a specific model
 */
export function checkModelCompatibility(
    ramRequiredGB: number,
    ramAvailableMB: number,
    modelId: string,
    modelName: string
): CompatibilityResult {
    const ramRequiredMB = ramRequiredGB * 1024;
    const ramAvailableGB = ramAvailableMB / 1024;
    const ratio = ramAvailableMB / ramRequiredMB;

    let level: CompatibilityResult['level'];
    let reason: string;
    let compatible: boolean;

    if (ratio >= 2) {
        level = 'excellent';
        reason = 'Your device exceeds the requirements';
        compatible = true;
    } else if (ratio >= 1.2) {
        level = 'good';
        reason = 'Your device meets the requirements';
        compatible = true;
    } else if (ratio >= 0.8) {
        level = 'marginal';
        reason = `May run slowly. Recommended: ${ramRequiredGB}GB RAM, yours: ${ramAvailableGB.toFixed(1)}GB`;
        compatible = true;
    } else {
        level = 'incompatible';
        reason = `Requires ${ramRequiredGB}GB RAM, your device has ~${ramAvailableGB.toFixed(1)}GB`;
        compatible = false;
    }

    return {
        modelId,
        modelName,
        compatible,
        level,
        reason,
        ramRequired: ramRequiredGB,
        ramAvailable: ramAvailableGB,
    };
}

/**
 * Check compatibility for multiple models
 */
export async function checkAllModelsCompatibility(
    models: Array<{ id: string; name: string; ram_required_gb: number }>
): Promise<CompatibilityResult[]> {
    const deviceInfo = await getDeviceInfo();
    
    return models.map(model => 
        checkModelCompatibility(
            model.ram_required_gb,
            deviceInfo.totalMemoryMB,
            model.id,
            model.name
        )
    );
}

/**
 * Get color for compatibility level
 */
export function getCompatibilityColor(level: CompatibilityResult['level']): string {
    switch (level) {
        case 'excellent':
            return '#22c55e'; // green
        case 'good':
            return '#84cc16'; // lime
        case 'marginal':
            return '#f59e0b'; // amber (warning)
        case 'incompatible':
            return '#ef4444'; // red
        default:
            return '#6b7280'; // gray
    }
}

/**
 * Get icon for compatibility level
 */
export function getCompatibilityIcon(level: CompatibilityResult['level']): string {
    switch (level) {
        case 'excellent':
            return 'checkmark-circle';
        case 'good':
            return 'checkmark';
        case 'marginal':
            return 'warning';
        case 'incompatible':
            return 'close-circle';
        default:
            return 'help-circle';
    }
}
