/**
 * AI Horde API Service
 * TypeScript client for AI Horde integration with image generation, text chat, and model management.
 */

import { cosmoAPI } from './api';

export interface HordeImageParams {
  prompt: string;
  negative_prompt?: string;
  model?: string;
  category?: 'realism' | 'anime' | 'flux' | 'furry';
  width?: number;
  height?: number;
  steps?: number;
  cfg_scale?: number;
  sampler?: string;
  temperature?: number;
  seed?: number;
  nsfw?: boolean;
  enhance_prompt?: boolean;
}

export interface HordeChatParams {
  prompt: string;
  user_id: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  character_id?: string;
  conversation_history?: Array<{ role: string; content: string }>;
}

export interface HordeModel {
  name: string;
  type: string;
  count: number;
  performance: number;
  queued: number;
  eta: number;
}

export interface HordeImageResult {
  success: boolean;
  image_url: string;
  seed: string;
  model: string;
  enhanced_prompt?: string;
  original_prompt?: string;
}

export interface HordeChatResult {
  success: boolean;
  response: string;
  model: string;
  tokens_used: number;
  character?: {
    id: string;
    name: string;
    avatar: string;
  };
}

export interface HordeModelsResult {
  success: boolean;
  models: HordeModel[];
  defaults: {
    realism: string;
    anime: string;
    flux: string;
    furry: string;
    chat: string;
  };
  total: number;
}

class HordeAPI {
  /**
   * Generate an image using AI Horde
   */
  async generateImage(params: HordeImageParams): Promise<HordeImageResult> {
    try {
      const result = await cosmoAPI.generateImage({
        prompt: params.prompt,
        negativePrompt: params.negative_prompt,
        width: params.width,
        height: params.height,
        numSteps: params.steps,
        guidanceScale: params.cfg_scale,
        modelId: params.model,
        isLocal: false,
      });

      return {
        success: true,
        image_url: result.image_url,
        seed: String(result.seed),
        model: params.model || 'cosmo-server',
        enhanced_prompt: params.prompt,
        original_prompt: params.prompt,
      };
    } catch (error: any) {
      console.error('Horde image generation failed:', error);
      throw error;
    }
  }

  /**
   * Chat using AI Horde text models
   */
  async chat(params: HordeChatParams): Promise<HordeChatResult> {
    try {
      const result = await cosmoAPI.chat({
        message: params.prompt,
        history: params.conversation_history,
        maxTokens: params.max_tokens,
        temperature: params.temperature,
        userId: params.user_id,
        smartMode: true,
        isLocal: false,
      });

      return {
        success: true,
        response: result.response,
        model: params.model || 'cosmo-smart',
        tokens_used: result.tokens_used,
      };
    } catch (error: any) {
      console.error('Horde chat failed:', error);
      throw error;
    }
  }

  /**
   * Get list of active AI Horde models
   */
  async getModels(modelType: 'image' | 'text' = 'image'): Promise<HordeModelsResult> {
    try {
      if (modelType === 'image') {
        const models = await cosmoAPI.getImageModels();
        return {
          success: true,
          models: models.map((model) => ({
            name: model.id,
            type: 'image',
            count: model.downloaded ? 1 : 0,
            performance: model.performance || 0,
            queued: model.queued || 0,
            eta: model.eta || 0,
          })),
          defaults: {
            realism: models[0]?.id || 'cyberrealistic-v9',
            anime: models[0]?.id || 'cyberrealistic-v9',
            flux: models[0]?.id || 'cyberrealistic-v9',
            furry: models[0]?.id || 'cyberrealistic-v9',
            chat: 'cosmo-smart',
          },
          total: models.length,
        };
      }

      const models = await cosmoAPI.getLLMModels();
      return {
        success: true,
        models: models.map((model) => ({
          name: model.id,
          type: 'text',
          count: model.downloaded ? 1 : 0,
          performance: 0,
          queued: 0,
          eta: 0,
        })),
        defaults: {
          realism: 'cyberrealistic-v9',
          anime: 'cyberrealistic-v9',
          flux: 'cyberrealistic-v9',
          furry: 'cyberrealistic-v9',
          chat: models[0]?.id || 'cosmo-smart',
        },
        total: models.length,
      };
    } catch (error: any) {
      console.error('Get horde models failed:', error);
      throw error;
    }
  }

  /**
   * Get status of a background task
   */
  async getTaskStatus(taskId: string): Promise<{
    success: boolean;
    task_id: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    task_type: string;
    created_at: string;
    result?: any;
    error?: string;
  }> {
    return {
      success: false,
      task_id: taskId,
      status: 'failed',
      task_type: 'compatibility',
      created_at: new Date().toISOString(),
      error: 'Background Horde task status is not supported by the current Cosmo backend.',
    };
  }

  /**
   * Enhance a prompt using AI
   */
  async enhancePrompt(prompt: string, style: string = 'realistic'): Promise<{
    success: boolean;
    original_prompt: string;
    enhanced_prompt: string;
    style: string;
  }> {
    try {
      const baseUrl = cosmoAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/horde/prompt/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, style }),
      });

      if (!response.ok) {
        // Return original prompt if enhancement fails
        return {
          success: false,
          original_prompt: prompt,
          enhanced_prompt: prompt,
          style,
        };
      }

      return await response.json();
    } catch (error: any) {
      console.error('Prompt enhancement failed:', error);
      return {
        success: false,
        original_prompt: prompt,
        enhanced_prompt: prompt,
        style,
      };
    }
  }
}

// Export singleton instance
export const hordeAPI = new HordeAPI();
export default hordeAPI;
