/**
 * Cosmo AI - Sampler Settings Service
 * Provides optimized sampler configurations for different quantization levels (Q2, Q4, Q8)
 * 
 * Based on ChatterUI and llama.cpp best practices for mobile inference.
 */

export interface SamplerSettings {
    temperature: number;
    top_p: number;
    top_k: number;
    min_p: number;           // Min-P sampling for better quality on Q2 models
    repeat_penalty: number;
    presence_penalty: number;
    frequency_penalty: number;
    
    // Mirostat settings
    mirostat: 0 | 1 | 2;     // 0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0
    mirostat_tau: number;
    mirostat_eta: number;
    
    // Context settings
    n_ctx: number;           // Context window size
    n_batch: number;         // Batch size for processing
    n_threads: number;       // CPU threads to use
}

export interface SamplerPreset {
    id: string;
    name: string;
    description: string;
    settings: SamplerSettings;
    recommendedFor: string[];  // Model quantizations this preset works well with
}

// === Q2 MODEL DEFAULTS ===
// Q2 models are heavily quantized - need lower temperature and Min-P for stability
export const Q2_MODEL_DEFAULTS: SamplerSettings = {
    temperature: 0.5,        // Lower temp for more deterministic outputs
    top_p: 0.9,
    top_k: 40,
    min_p: 0.05,             // Min-P sampling crucial for Q2 quality
    repeat_penalty: 1.1,
    presence_penalty: 0.0,
    frequency_penalty: 0.0,
    mirostat: 0,
    mirostat_tau: 5.0,
    mirostat_eta: 0.1,
    n_ctx: 2048,             // Lower context for Q2 on mobile
    n_batch: 256,
    n_threads: 4,
};

// === Q3 MODEL DEFAULTS ===
export const Q3_MODEL_DEFAULTS: SamplerSettings = {
    temperature: 0.6,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.03,
    repeat_penalty: 1.1,
    presence_penalty: 0.0,
    frequency_penalty: 0.0,
    mirostat: 0,
    mirostat_tau: 5.0,
    mirostat_eta: 0.1,
    n_ctx: 2048,
    n_batch: 256,
    n_threads: 4,
};

// === Q4 MODEL DEFAULTS ===
// Q4 models are the sweet spot - can handle normal sampling
export const Q4_MODEL_DEFAULTS: SamplerSettings = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.0,              // Min-P less critical for Q4
    repeat_penalty: 1.1,
    presence_penalty: 0.0,
    frequency_penalty: 0.0,
    mirostat: 0,
    mirostat_tau: 5.0,
    mirostat_eta: 0.1,
    n_ctx: 4096,
    n_batch: 512,
    n_threads: 4,
};

// === Q5/Q6 MODEL DEFAULTS ===
export const Q5_MODEL_DEFAULTS: SamplerSettings = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.0,
    repeat_penalty: 1.1,
    presence_penalty: 0.0,
    frequency_penalty: 0.0,
    mirostat: 0,
    mirostat_tau: 5.0,
    mirostat_eta: 0.1,
    n_ctx: 4096,
    n_batch: 512,
    n_threads: 4,
};

// === Q8 MODEL DEFAULTS ===
// Highest quantization - can use higher temperature for creativity
export const Q8_MODEL_DEFAULTS: SamplerSettings = {
    temperature: 0.8,
    top_p: 0.95,
    top_k: 50,
    min_p: 0.0,
    repeat_penalty: 1.1,
    presence_penalty: 0.0,
    frequency_penalty: 0.0,
    mirostat: 0,
    mirostat_tau: 5.0,
    mirostat_eta: 0.1,
    n_ctx: 4096,
    n_batch: 512,
    n_threads: 4,
};

// === PRESET LIBRARY ===
export const SAMPLER_PRESETS: SamplerPreset[] = [
    {
        id: 'default',
        name: 'Default',
        description: 'Balanced settings for general use',
        settings: Q4_MODEL_DEFAULTS,
        recommendedFor: ['Q4_K_M', 'Q4_K_S', 'Q5_K_M'],
    },
    {
        id: 'creative',
        name: 'Creative',
        description: 'Higher randomness for creative writing',
        settings: {
            ...Q4_MODEL_DEFAULTS,
            temperature: 0.9,
            top_p: 0.95,
            top_k: 100,
        },
        recommendedFor: ['Q4_K_M', 'Q5_K_M', 'Q8'],
    },
    {
        id: 'precise',
        name: 'Precise',
        description: 'Low randomness for factual responses',
        settings: {
            ...Q4_MODEL_DEFAULTS,
            temperature: 0.3,
            top_p: 0.8,
            top_k: 30,
            repeat_penalty: 1.2,
        },
        recommendedFor: ['Q4_K_M', 'Q5_K_M', 'Q8'],
    },
    {
        id: 'q2-stable',
        name: 'Q2 Stable',
        description: 'Optimized for Q2 quantized models',
        settings: Q2_MODEL_DEFAULTS,
        recommendedFor: ['Q2_K', 'IQ2_XS', 'IQ2_XXS'],
    },
    {
        id: 'roleplay',
        name: 'Roleplay',
        description: 'Optimized for character roleplay',
        settings: {
            ...Q4_MODEL_DEFAULTS,
            temperature: 0.85,
            top_p: 0.95,
            repeat_penalty: 1.05,
            presence_penalty: 0.1,
        },
        recommendedFor: ['Q4_K_M', 'Q5_K_M', 'Q8'],
    },
    {
        id: 'mirostat',
        name: 'Mirostat 2.0',
        description: 'Uses Mirostat for consistent perplexity',
        settings: {
            ...Q4_MODEL_DEFAULTS,
            mirostat: 2,
            mirostat_tau: 5.0,
            mirostat_eta: 0.1,
        },
        recommendedFor: ['Q4_K_M', 'Q5_K_M', 'Q8'],
    },
];

/**
 * Get optimal sampler settings based on model quantization
 */
export function getSettingsForQuantization(quantization: string): SamplerSettings {
    const q = quantization.toUpperCase();
    
    if (q.includes('Q2') || q.includes('IQ2')) {
        return Q2_MODEL_DEFAULTS;
    }
    if (q.includes('Q3') || q.includes('IQ3')) {
        return Q3_MODEL_DEFAULTS;
    }
    if (q.includes('Q4') || q.includes('IQ4')) {
        return Q4_MODEL_DEFAULTS;
    }
    if (q.includes('Q5')) {
        return Q5_MODEL_DEFAULTS;
    }
    if (q.includes('Q6') || q.includes('Q8') || q.includes('F16')) {
        return Q8_MODEL_DEFAULTS;
    }
    
    // Default to Q4 settings
    return Q4_MODEL_DEFAULTS;
}

/**
 * Get recommended presets for a quantization level
 */
export function getPresetsForQuantization(quantization: string): SamplerPreset[] {
    return SAMPLER_PRESETS.filter(preset => 
        preset.recommendedFor.some(q => 
            quantization.toUpperCase().includes(q.toUpperCase())
        )
    );
}

/**
 * Merge user settings with defaults for a quantization level
 */
export function mergeSettings(
    quantization: string,
    userSettings: Partial<SamplerSettings>
): SamplerSettings {
    const defaults = getSettingsForQuantization(quantization);
    return { ...defaults, ...userSettings };
}

export default {
    Q2_MODEL_DEFAULTS,
    Q3_MODEL_DEFAULTS,
    Q4_MODEL_DEFAULTS,
    Q5_MODEL_DEFAULTS,
    Q8_MODEL_DEFAULTS,
    SAMPLER_PRESETS,
    getSettingsForQuantization,
    getPresetsForQuantization,
    mergeSettings,
};
