/**
 * Vision Generation Service
 * Automatically selects the fastest AI Horde server for image generation
 */

import { hordeAPI } from './hordeAPI';

export interface VisionGenerationOptions {
    prompt: string;
    width?: number;
    height?: number;
    steps?: number;
}

/**
 * Generate vision from text using fastest available AI Horde server
 * Automatically selects best model based on speed and availability
 */
import { whisperAPI } from './api';

export async function generateVisionFromText(
    prompt: string,
    options: Partial<VisionGenerationOptions> = {}
): Promise<string | null> {
    const {
        width = 512,
        height = 512,
        steps = 20,
    } = options;

    try {
    // 1. Try AI Horde with automatic retries on multiple models
        const result = await hordeAPI.getModels('image');

        if (result.success && result.models && result.models.length > 0) {
        // Sort by speed: count (more workers = faster) and performance
            const fastestModels = result.models
                .filter((m: any) => m.count > 0)
                .sort((a: any, b: any) => {
                    const scoreA = a.count * 10 - (a.queued || 0);
                    const scoreB = b.count * 10 - (b.queued || 0);
                    return scoreB - scoreA;
                })
                .slice(0, 3); // Attempt top 3 models

            if (fastestModels.length > 0) {
                console.log(`🚀 Attempting generation with top ${fastestModels.length} models...`);

                for (const model of fastestModels) {
                    try {
                        console.log(`Trying model: ${model.name} (${model.count} workers)...`);
                        const imageResult = await hordeAPI.generateImage({
                            prompt,
                             model: model.name,
                             width,
                             height,
                             steps,
                             cfg_scale: 7.0,
                             sampler: 'k_euler_a',
                             nsfw: true,
                         });

                         if (imageResult.success && imageResult.image_url) {
                            return imageResult.image_url;
                        }
                    } catch (e) {
                        console.warn(`Model ${model.name} failed, trying next...`, e);
                    }
                }
            }
        }
    } catch (hordeError) {
        console.warn('AI Horde completely failed, falling back...', hordeError);
    }

    // 2. Fallback to Whisper Server (DALL-E / Server Local)
    try {
        console.log('Falling back to Whisper Server generation...');
        const response = await whisperAPI.generateImage({
            prompt,
            width,
            height,
            isLocal: false, // Use server resources
        });
        return response.image_url;
    } catch (serverError) {
        console.error('All vision generation methods failed:', serverError);
        return null;
    }
}

/**
 * Get the fastest available image model info
 */
export async function getFastestImageModel(): Promise<{ name: string; workers: number; eta: number } | null> {
    try {
        const result = await hordeAPI.getModels('image');

        if (!result.success || !result.models || result.models.length === 0) {
            return null;
        }

        const fastest = result.models
            .filter((m: any) => m.count > 0)
            .sort((a: any, b: any) => {
                const scoreA = a.count * 10 - (a.queued || 0);
                const scoreB = b.count * 10 - (b.queued || 0);
                return scoreB - scoreA;
            })[0];

        if (!fastest) return null;

        return {
            name: fastest.name,
            workers: fastest.count,
            eta: fastest.eta || 0,
        };

    } catch (error) {
        console.error('Failed to get fastest model:', error);
        return null;
    }
}
