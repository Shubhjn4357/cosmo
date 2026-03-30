/**
 * Smart Mode Service
 * Auto-selects best AI model (Whisper, Local, or Horde) based on:
 * - Speed
 * - Availability
 * - Task complexity
 */

import { whisperAPI } from './api';
import { hordeAPI } from './hordeAPI';

export type SmartModelType = 'Whisper' | 'local' | 'horde';

export interface SmartModelSelection {
  model: SmartModelType;
  reason: string;
  confidence: number;
}

/**
 * Select best model for text generation
 */
export async function selectBestTextModel(
  prompt: string,
  requiresFast: boolean = false
): Promise<SmartModelSelection> {
  try {
    // Check server availability
    const serverAvailable = await checkWhisperAvailability();
    
    // Analyze prompt complexity
    const complexity = analyzePromptComplexity(prompt);
    
    // Decision logic
    if (requiresFast) {
      // Need speed - prioritize local or fastest horde
      return {
        model: 'local',
        reason: 'Fast response required - using local model',
        confidence: 0.9,
      };
    }
    
    if (complexity > 0.7 && serverAvailable) {
      // Complex query - use Whisper (best quality)
      return {
        model: 'Whisper',
        reason: 'Complex query - using Whisper for best quality',
        confidence: 0.85,
      };
    }
    
    if (complexity < 0.3) {
      // Simple query - local is fine
      return {
        model: 'local',
        reason: 'Simple query - local model sufficient',
        confidence: 0.8,
      };
    }
    
    // Default: Whisper if available, else Horde
    if (serverAvailable) {
      return {
        model: 'Whisper',
        reason: 'Whisper available - using for quality',
        confidence: 0.75,
      };
    }
    
    return {
      model: 'horde',
      reason: 'Whisper unavailable - using AI Horde',
      confidence: 0.7,
    };
    
  } catch (error) {
    console.error('Smart model selection failed:', error);
    return {
      model: 'horde',
      reason: 'Fallback to AI Horde',
      confidence: 0.5,
    };
  }
}

/**
 * Select best model for image generation
 */
export async function selectBestImageModel(): Promise<SmartModelSelection> {
  try {
    // For images, AI Horde is usually best (multiple models, fast)
    const hordeModels = await hordeAPI.getModels('image');
    
    if (hordeModels.success && hordeModels.models.length > 0) {
      return {
        model: 'horde',
        reason: 'AI Horde has multiple fast image models',
        confidence: 0.95,
      };
    }
    
    // Fallback to Whisper
    return {
      model: 'Whisper',
      reason: 'Fallback to Whisper server',
      confidence: 0.6,
    };
    
  } catch (error) {
    return {
      model: 'Whisper',
      reason: 'Error checking models - using Whisper',
      confidence: 0.5,
    };
  }
}

/**
 * Analyze prompt complexity (0-1 scale)
 */
function analyzePromptComplexity(prompt: string): number {
  let score = 0;
  
  // Length
  if (prompt.length > 200) score += 0.3;
  else if (prompt.length > 100) score += 0.2;
  else score += 0.1;
  
  // Question words (complex queries)
  const questionWords = ['why', 'how', 'explain', 'analyze', 'compare', 'detailed'];
  const hasQuestion = questionWords.some(word => 
    prompt.toLowerCase().includes(word)
  );
  if (hasQuestion) score += 0.3;
  
  // Code or technical terms
  const techPatterns = /```|function|class|const|let|var|import|export|<\w+>|{|}|\[|\]/g;
  if (techPatterns.test(prompt)) score += 0.2;
  
  // Multi-step requests
  const steps = prompt.split(/\n|\./).filter(s => s.trim().length > 0);
  if (steps.length > 3) score += 0.2;
  
  return Math.min(score, 1.0);
}

/**
 * Check if Whisper server is available
 */
async function checkWhisperAvailability(): Promise<boolean> {
  try {
    const baseUrl = whisperAPI.getBaseUrl();
    const response = await fetch(`${baseUrl}/health`, { 
      method: 'GET',
      timeout: 3000,
    } as any);
    return response.ok;
  } catch {
    return false;
  }
}
