/**
 * Cosmo Web Frontend - Core Types
 * Centralized registry for dashboard and chat interfaces.
 */

export interface AgentStep {
    role: string;
    content: string;
}

export interface ChatResponse {
    response?: string;
    final_response?: string;
    model_used?: string;
    backend?: string;
    agent_steps?: AgentStep[];
}

// Admin & System Types
export interface SystemAnalytics {
    analytics: {
        generations: number;
        errors: number;
    };
    status?: string;
    memory_usage?: string;
    inference_load?: string;
}

export interface ExecutionProfile {
    id: string;
    name: string;
    description: string;
    active?: boolean;
}

export interface AgentStatus {
    wallet: {
        address: string;
        balance: number;
        controller_address: string | null;
    };
}

export interface KnowledgeDataset {
    name: string;
    size_mb: number;
    item_count: number;
    path?: string;
}

// Business & Workforce Types
export interface BusinessRole {
    id: string;
    name: string;
    description?: string;
}

export interface BusinessSession {
    id: string;
    goal: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
    task_count: number;
    created_at?: string;
}

// Global Window Extensions
export interface EthereumRequestArgs {
    method: string;
    params?: unknown[];
}

export interface EthereumProvider {
    request: (args: EthereumRequestArgs) => Promise<unknown>;
    on?: (event: string, callback: (...args: any[]) => void) => void;
    removeListener?: (event: string, callback: (...args: any[]) => void) => void;
    isMetaMask?: boolean;
}

declare global {
    interface Window {
        ethereum?: EthereumProvider;
    }
}
