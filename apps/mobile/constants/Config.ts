import { Platform } from 'react-native';

/**
 * Cosmo AI - Global Configuration
 * ==============================
 * Centralized settings for the Cosmo AI ecosystem.
 */

export const COSMO_API_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-cosmo-ai.hf.space';

export const CONFIG = {
    API_URL: COSMO_API_URL,
    VERSION: '3.6.0-cosmo-alpha', // Increment for architecture shift
    IS_WEB: Platform.OS === 'web',
    IS_PROD: !__DEV__,
    
    // Performance & Model Strategy
    MAX_IMAGE_WIDTH: 1024,
    MAX_HISTORY_LENGTH: 50,
    
    /**
     * AI Runtime Preferences
     * ======================
     * PREFER_AIRLLM: When true, heavy 70B+ models are routed to the AirLLM-optimized backend sync.
     * BITNET_EXPERIMENTAL: Enables the future JSI bridge for BitNet.cpp (up to 5x ARM speedup).
     */
    PREFER_AIRLLM_FOR_HEAVY_MODELS: true,
    BITNET_EXPERIMENTAL_ENABLED: true, 
    
    // Feature flags
    SELF_LEARNER_ENABLED: true,
    BUSINESS_AGENT_ENABLED: true,
    OFFLINE_MODE_SUPPORTED: true,
};

export default {
    COSMO_API_URL,
    CONFIG,
};
