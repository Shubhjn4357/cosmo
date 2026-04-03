/**
 * AI Horde API Service
 * TypeScript client for AI Horde integration with image generation, text chat, and model management.
 */

import { whisperAPI } from './api';

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
      const baseUrl = whisperAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/horde/image/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      return await response.json();
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
      const baseUrl = whisperAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/horde/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: params.prompt,
          user_id: params.user_id,
          model: params.model,
          max_tokens: params.max_tokens,
          temperature: params.temperature,
          character_id: params.character_id,
          conversation_history: params.conversation_history,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      return await response.json();
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
      const baseUrl = whisperAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/horde/models?model_type=${modelType}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
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
    try {
      const baseUrl = whisperAPI.getBaseUrl();
      const response = await fetch(`${baseUrl}/api/horde/tasks/${taskId}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('Get task status failed:', error);
      throw error;
    }
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
      const baseUrl = whisperAPI.getBaseUrl();
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
