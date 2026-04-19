/**
 * Vision Generation Service
 * Uses Cosmo's local multimodal path before falling back to the local image runtime.
 */

import { cosmoAPI } from './api';

export interface VisionGenerationOptions {
    prompt: string;
    width?: number;
    height?: number;
    steps?: number;
}

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
        const result = await cosmoAPI.generateVisionImage({
            prompt,
            use_pretrained: false,
        });
        if (result.generated_image) {
            return result.generated_image;
        }
    } catch (visionError) {
        console.warn('Local vision-memory generation failed, falling back to the local image runtime...', visionError);
    }

    try {
        const response = await cosmoAPI.generateImage({
            prompt,
            width,
            height,
            numSteps: steps,
            isLocal: true,
        });
        return response.image_url;
    } catch (serverError) {
        console.error('All local vision generation methods failed:', serverError);
        return null;
    }
}

export async function getFastestImageModel(): Promise<{ name: string; workers: number; eta: number } | null> {
    return {
        name: 'local-self-vision',
        workers: 1,
        eta: 0,
    };
}
