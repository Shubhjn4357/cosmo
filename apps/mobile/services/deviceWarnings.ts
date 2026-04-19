/**
 * Cosmo AI - Device Warnings Service
 * Monitors device resources and provides warnings for:
 * - VRAM/RAM usage and limits
 * - Thermal conditions
 * - Battery status
 * 
 * Helps users select appropriate model sizes for their device.
 */

import { Platform, NativeModules } from 'react-native';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

// === TYPES ===

export interface DeviceResources {
    totalRam: number;          // RAM in GB
    availableRam: number;      // Available RAM in GB
    usedRam: number;           // Used RAM in GB
    ramUsagePercent: number;   // RAM usage as percentage
    
    // Device info
    deviceType: 'low-end' | 'mid-range' | 'high-end' | 'flagship';
    maxModelSize: number;      // Recommended max model size in GB
    
    // Thermal status
    thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
    
    // Battery
    batteryLevel: number;      // 0-1
    isCharging: boolean;
}

export interface ResourceWarning {
    type: 'ram' | 'thermal' | 'battery' | 'model_size';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    action?: string;
}

export interface ModelCompatibility {
    compatible: boolean;
    warnings: ResourceWarning[];
    recommendations: string[];
}

// === DEVICE CLASSIFICATION ===

// RAM thresholds for device classification
const DEVICE_CLASSIFICATIONS = {
    'low-end': { minRam: 0, maxRam: 4, maxModelSize: 1.5 },      // 1-4GB RAM
    'mid-range': { minRam: 4, maxRam: 6, maxModelSize: 3 },     // 4-6GB RAM
    'high-end': { minRam: 6, maxRam: 8, maxModelSize: 5 },      // 6-8GB RAM
    'flagship': { minRam: 8, maxRam: Infinity, maxModelSize: 8 }, // 8GB+ RAM
};

// Model size estimates by quantization
export const MODEL_SIZE_ESTIMATES: Record<string, number> = {
    // 1B models
    'llama-1b-q2': 0.5,
    'llama-1b-q4': 0.7,
    'llama-1b-q8': 1.2,
    // 3B models
    'llama-3b-q2': 1.2,
    'llama-3b-q4': 2.0,
    'llama-3b-q8': 3.5,
    // 7B models
    'llama-7b-q2': 2.5,
    'llama-7b-q4': 4.0,
    'llama-7b-q8': 7.5,
    // 8B models
    'llama-8b-q2': 2.8,
    'llama-8b-q4': 4.5,
    'llama-8b-q8': 8.5,
};

class DeviceWarningsService {
    private cachedResources: DeviceResources | null = null;
    private lastCheck: number = 0;
    private checkInterval: number = 5000; // 5 seconds
    
    /**
     * Get current device resources
     */
    async getDeviceResources(): Promise<DeviceResources> {
        const now = Date.now();
        
        // Return cached if recent
        if (this.cachedResources && (now - this.lastCheck) < this.checkInterval) {
            return this.cachedResources;
        }
        
        try {
            // Get device memory info
            const totalMemoryBytes = Device.totalMemory || 0;
            const totalRam = totalMemoryBytes / (1024 * 1024 * 1024); // Convert to GB
            
            // Estimate available RAM (platform-specific)
            let availableRam = totalRam * 0.5; // Default estimate
            let thermalState: DeviceResources['thermalState'] = 'nominal';
            
            // Try to get more accurate info via native modules (if available)
            if (Platform.OS === 'android' && NativeModules.MemoryInfo) {
                try {
                    const memInfo = await NativeModules.MemoryInfo.getMemoryInfo();
                    availableRam = memInfo.availMem / (1024 * 1024 * 1024);
                } catch {
                    // Use estimate
                }
            }
            
            if (Platform.OS === 'ios' && NativeModules.ThermalState) {
                try {
                    const state = await NativeModules.ThermalState.getCurrentState();
                    thermalState = state as DeviceResources['thermalState'];
                } catch {
                    // Use default
                }
            }
            
            // Classify device
            const deviceType = this.classifyDevice(totalRam);
            const maxModelSize = DEVICE_CLASSIFICATIONS[deviceType].maxModelSize;
            
            const resources: DeviceResources = {
                totalRam,
                availableRam,
                usedRam: totalRam - availableRam,
                ramUsagePercent: ((totalRam - availableRam) / totalRam) * 100,
                deviceType,
                maxModelSize,
                thermalState,
                batteryLevel: 1, // Default, would need native module
                isCharging: false,
            };
            
            this.cachedResources = resources;
            this.lastCheck = now;
            
            return resources;
        } catch (error) {
            console.error('Failed to get device resources:', error);
            // Return safe defaults
            return {
                totalRam: 4,
                availableRam: 2,
                usedRam: 2,
                ramUsagePercent: 50,
                deviceType: 'mid-range',
                maxModelSize: 3,
                thermalState: 'nominal',
                batteryLevel: 1,
                isCharging: false,
            };
        }
    }
    
    /**
     * Classify device based on total RAM
     */
    private classifyDevice(totalRam: number): DeviceResources['deviceType'] {
        if (totalRam >= 8) return 'flagship';
        if (totalRam >= 6) return 'high-end';
        if (totalRam >= 4) return 'mid-range';
        return 'low-end';
    }
    
    /**
     * Check if a model is compatible with the device
     */
    async checkModelCompatibility(
        modelSizeGb: number,
        ramRequiredGb: number,
        quantization: string
    ): Promise<ModelCompatibility> {
        const resources = await this.getDeviceResources();
        const warnings: ResourceWarning[] = [];
        const recommendations: string[] = [];
        let compatible = true;
        
        // Check RAM requirements
        if (ramRequiredGb > resources.totalRam) {
            compatible = false;
            warnings.push({
                type: 'ram',
                severity: 'critical',
                title: '⛔ Insufficient RAM',
                message: `This model requires ${ramRequiredGb}GB RAM, but your device has ${resources.totalRam.toFixed(1)}GB.`,
                action: 'Consider a smaller quantization (Q2 or Q4) or a smaller model.',
            });
        } else if (ramRequiredGb > resources.availableRam) {
            warnings.push({
                type: 'ram',
                severity: 'warning',
                title: '⚠️ Low Available RAM',
                message: `Model needs ${ramRequiredGb}GB but only ${resources.availableRam.toFixed(1)}GB available. Close other apps first.`,
            });
        }
        
        // Check model size
        if (modelSizeGb > resources.maxModelSize) {
            warnings.push({
                type: 'model_size',
                severity: 'warning',
                title: '⚠️ Large Model',
                message: `This is a large model (${modelSizeGb}GB). Your ${resources.deviceType} device may struggle.`,
                action: 'Consider a Q2 or Q4 quantization for better performance.',
            });
        }
        
        // Check thermal state
        if (resources.thermalState === 'serious' || resources.thermalState === 'critical') {
            warnings.push({
                type: 'thermal',
                severity: resources.thermalState === 'critical' ? 'critical' : 'warning',
                title: '🌡️ Device is Hot',
                message: resources.thermalState === 'critical'
                    ? 'Device is critically hot! Wait for it to cool down before running models.'
                    : 'Device is running warm. Performance may be reduced.',
            });
            if (resources.thermalState === 'critical') {
                compatible = false;
            }
        }
        
        // Add recommendations based on device type
        if (resources.deviceType === 'low-end') {
            recommendations.push('Use Q2 quantization for best performance');
            recommendations.push('Close all other apps before loading model');
            recommendations.push('Keep model size under 2GB');
        } else if (resources.deviceType === 'mid-range') {
            recommendations.push('Q4 quantization recommended for balance');
            recommendations.push('Keep model size under 4GB');
        } else if (resources.deviceType === 'high-end' || resources.deviceType === 'flagship') {
            recommendations.push('Q4 or Q5 quantization for best quality');
            recommendations.push('Can run up to 8B models with Q4');
        }
        
        // Quantization-specific recommendations
        if (quantization.includes('Q2') || quantization.includes('IQ2')) {
            recommendations.push('Use Min-P sampling (0.05) for better Q2 output quality');
            recommendations.push('Lower temperature (0.5-0.6) recommended');
        }
        
        return { compatible, warnings, recommendations };
    }
    
    /**
     * Get thermal warning
     */
    async getThermalWarning(): Promise<ResourceWarning | null> {
        const resources = await this.getDeviceResources();
        
        if (resources.thermalState === 'critical') {
            return {
                type: 'thermal',
                severity: 'critical',
                title: '🔥 Critical Temperature',
                message: 'Device is overheating! Model inference paused. Please wait for device to cool down.',
            };
        }
        
        if (resources.thermalState === 'serious') {
            return {
                type: 'thermal',
                severity: 'warning',
                title: '🌡️ High Temperature',
                message: 'Device is getting hot. Performance may be throttled. Consider taking a break.',
            };
        }
        
        return null;
    }
    
    /**
     * Get RAM warning
     */
    async getRamWarning(): Promise<ResourceWarning | null> {
        const resources = await this.getDeviceResources();
        
        if (resources.ramUsagePercent > 90) {
            return {
                type: 'ram',
                severity: 'critical',
                title: '⛔ Critical RAM Usage',
                message: 'Memory is almost full! App may crash. Close other apps immediately.',
            };
        }
        
        if (resources.ramUsagePercent > 75) {
            return {
                type: 'ram',
                severity: 'warning',
                title: '⚠️ High RAM Usage',
                message: `Using ${resources.ramUsagePercent.toFixed(0)}% of RAM. Consider closing other apps.`,
            };
        }
        
        return null;
    }
    
    /**
     * Get all current warnings
     */
    async getAllWarnings(): Promise<ResourceWarning[]> {
        const warnings: ResourceWarning[] = [];
        
        const thermalWarning = await this.getThermalWarning();
        if (thermalWarning) warnings.push(thermalWarning);
        
        const ramWarning = await this.getRamWarning();
        if (ramWarning) warnings.push(ramWarning);
        
        return warnings;
    }
    
    /**
     * Suggest best quantization for current device
     */
    async suggestQuantization(modelParamsBillions: number): Promise<string> {
        const resources = await this.getDeviceResources();
        
        // Calculate which quantization fits
        // Rough formula: model_size_gb ≈ params_billions * quantization_factor
        const quantFactors: Record<string, number> = {
            'Q2_K': 0.3,
            'Q3_K_M': 0.4,
            'Q4_K_M': 0.55,
            'Q5_K_M': 0.7,
            'Q8_0': 1.0,
        };
        
        const availableGb = resources.maxModelSize * 0.8; // Leave 20% headroom
        
        for (const [quant, factor] of Object.entries(quantFactors)) {
            const estimatedSize = modelParamsBillions * factor;
            if (estimatedSize <= availableGb) {
                return quant;
            }
        }
        
        return 'Q2_K'; // Fallback to smallest
    }
}

export const deviceWarnings = new DeviceWarningsService();
export default deviceWarnings;
