/**
 * Cosmo AI - Smart Mode Service
 * =============================
 * Auto-selects best AI model (Cosmo, Local, or Horde) based on:
 * 1. Complexity of user query
 * 2. Network status (online/offline)
 * 3. Local model availability
 */

import { getIsOnline } from './offlineSync';
import { localLLM } from './localLLM';
import { cosmoAPI } from './api';

export type SmartModelType = 'Cosmo' | 'local' | 'horde';

export interface SmartDecision {
    model: SmartModelType;
    reason: string;
}

/**
 * Main selection logic
 */
export async function getSmartDecision(message: string): Promise<SmartDecision> {
    const isOnline = getIsOnline();
    const isLocalModelReady = await localLLM.isReady();

    // 1. Basic check: If offline, MUST use local
    if (!isOnline) {
        if (isLocalModelReady) {
            return {
                model: 'local',
                reason: 'Offline mode - using high-performance local transformer',
            };
        }
        return {
            model: 'local', // Forced attempt
            reason: 'Offline - local is only option',
        };
    }

    // 2. Query Complexity Analysis
    const complexityScore = analyzeComplexity(message);
    
    // Check if server is reachable
    const serverAvailable = await checkCosmoAvailability();

    if (serverAvailable) {
        if (complexityScore > 7) {
            // Complex query - use Cosmo (best quality)
            return {
                model: 'Cosmo',
                reason: 'Complex query - using Cosmo for best quality',
            };
        }

        if (!isLocalModelReady) {
            // Local not ready - use Cosmo
            return {
                model: 'Cosmo',
                reason: 'Local model not loaded - using Cosmo server',
            };
        }

        // Default: Cosmo if available, else Horde
        return {
            model: 'Cosmo',
            reason: 'Cosmo available - using for quality',
        };
    }

    // 3. Fallback to AI Horde if Cosmo server is down
    if (complexityScore > 5) {
        return {
            model: 'horde',
            reason: 'Cosmo unavailable - using AI Horde',
        };
    }

    // 4. Default to local if ready and simple enough
    if (isLocalModelReady) {
        return {
            model: 'local',
            reason: 'Using efficient local model for simple query',
        };
    }

    // Fallback to Cosmo
    return {
      model: 'Cosmo',
      reason: 'Fallback to Cosmo server',
    };
}

/**
 * Simple complexity analysis
 */
function analyzeComplexity(text: string): number {
    let score = 0;
    const len = text.length;
    
    if (len > 100) score += 3;
    if (len > 500) score += 5;
    
    // Check for "intelligent" keywords
    const keywords = ['analyze', 'explain', 'compare', 'code', 'calculate', 'summarize'];
    keywords.forEach(word => {
        if (text.toLowerCase().includes(word)) score += 2;
    });
    
    return score;
}

/**
 * Check if Cosmo server is available
 */
async function checkCosmoAvailability(): Promise<boolean> {
    try {
        const res = await fetch(`${cosmoAPI.getBaseUrl()}/health`);
        return res.ok;
    } catch {
        return false;
    }
}
