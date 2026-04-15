import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ModelType } from '@/types';

import {
    cosmoAPI,
    type AgentPlanStep,
    type AgentRunResponse,
    type AgentToolResult,
} from './api';

const ACTIVE_TASK_KEY = '@cosmo_agent_active_task';
const TASK_HISTORY_KEY = '@cosmo_agent_task_history';
const MAX_TASK_HISTORY = 20;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

export type CosmoAgentBackend = 'server' | 'self_learner' | 'cloud';

export interface CosmoAgentTask {
    sessionId: string;
    prompt: string;
    status: string;
    backend: CosmoAgentBackend;
    answer: string;
    imageUrl?: string | null;
    plan: AgentPlanStep[];
    toolResults: AgentToolResult[];
    citations: { source: string; score?: number; chunk?: number }[];
    updatedAt?: number;
    baseUrl: string;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export interface CosmoAgentRequest {
    message: string;
    history?: { role: string; content: string }[];
    sessionId?: string;
    context?: string;
    systemPrompt?: string;
    useRAG?: boolean;
    nsfwMode?: boolean;
    roleplayMode?: boolean;
    modelMode?: ModelType;
    allowResearch?: boolean;
    allowImages?: boolean;
    maxSteps?: number;
    maxTokens?: number;
    userId?: string;
}

function resolveAgentBackend(mode: ModelType = 'server'): CosmoAgentBackend {
    if (mode === 'cloud') return 'cloud';
    if (mode === 'self-learner') return 'self_learner';
    return 'server';
}

function toTask(response: AgentRunResponse, prompt: string): CosmoAgentTask {
    return {
        sessionId: response.session_id,
        prompt,
        status: response.status,
        backend: response.backend as CosmoAgentBackend,
        answer: response.answer,
        imageUrl: response.image_url,
        plan: response.plan || [],
        toolResults: response.tool_results || [],
        citations: response.citations || [],
        updatedAt: response.updated_at,
        baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-cosmo-ai.hf.space',
    };
}

async function loadHistory(): Promise<CosmoAgentTask[]> {
    try {
        const raw = await AsyncStorage.getItem(TASK_HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Failed to load agent task history:', error);
        return [];
    }
}

async function persistTask(task: CosmoAgentTask): Promise<void> {
    try {
        await AsyncStorage.setItem(ACTIVE_TASK_KEY, JSON.stringify(task));

        const history = await loadHistory();
        const deduped = [task, ...history.filter((entry) => entry.sessionId !== task.sessionId)]
            .slice(0, MAX_TASK_HISTORY);
        await AsyncStorage.setItem(TASK_HISTORY_KEY, JSON.stringify(deduped));
    } catch (error) {
        console.error('Failed to persist agent task:', error);
    }
}

class AgentModeService {
    resolveBackend(mode: ModelType = 'server'): CosmoAgentBackend {
        return resolveAgentBackend(mode);
    }

    async think(request: CosmoAgentRequest): Promise<CosmoAgentTask> {
        const task = await this.startTask(request);
        return this.waitForTask(task.sessionId);
    }

    async startTask(request: CosmoAgentRequest): Promise<CosmoAgentTask> {
        const response = await cosmoAPI.runAgent({
            message: request.message,
            history: request.history || [],
            sessionId: request.sessionId,
            context: request.context,
            systemPrompt: request.systemPrompt,
            useRAG: request.useRAG !== false,
            nsfwMode: request.nsfwMode || false,
            roleplayMode: request.roleplayMode || false,
            backend: resolveAgentBackend(request.modelMode || 'server'),
            allowResearch: request.allowResearch !== false,
            allowImages: request.allowImages !== false,
            maxSteps: request.maxSteps || 4,
            maxTokens: request.maxTokens || 320,
            userId: request.userId,
            waitForCompletion: false,
        });

        const task = toTask(response, request.message);
        await persistTask(task);
        return task;
    }

    async createTask(request: CosmoAgentRequest): Promise<CosmoAgentTask> {
        return this.startTask(request);
    }

    async getCurrentTask(): Promise<CosmoAgentTask | null> {
        try {
            const raw = await AsyncStorage.getItem(ACTIVE_TASK_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.error('Failed to load current agent task:', error);
            return null;
        }
    }

    async getTaskHistory(): Promise<CosmoAgentTask[]> {
        return loadHistory();
    }

    async refreshTask(sessionId: string): Promise<CosmoAgentTask> {
        const response = await cosmoAPI.getAgentSession(sessionId);
        const task: CosmoAgentTask = {
            sessionId: response.id,
            prompt: response.goal || '',
            status: response.status,
            backend: (response.backend_resolved || 'server') as CosmoAgentBackend,
            answer: response.answer || '',
            imageUrl: response.image_url,
            plan: response.plan || [],
            toolResults: response.tool_results || [],
            citations: response.citations || [],
            updatedAt: response.updated_at,
            baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-cosmo-ai.hf.space',
        };
        await persistTask(task);
        return task;
    }

    isTerminalStatus(status: string | undefined | null): boolean {
        return TERMINAL_STATUSES.has(String(status || '').toLowerCase());
    }

    async waitForTask(
        sessionId: string,
        options: { timeoutMs?: number; pollIntervalMs?: number } = {}
    ): Promise<CosmoAgentTask> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
        const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        const startedAt = Date.now();

        let latest = await this.refreshTask(sessionId);
        while (!this.isTerminalStatus(latest.status)) {
            if (Date.now() - startedAt >= timeoutMs) {
                return latest;
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            latest = await this.refreshTask(sessionId);
        }
        return latest;
    }

    async resumeActiveTask(): Promise<CosmoAgentTask | null> {
        const task = await this.getCurrentTask();
        if (!task) return null;
        if (this.isTerminalStatus(task.status)) return task;
        try {
            return await this.refreshTask(task.sessionId);
        } catch (error) {
            console.error('Failed to resume active agent task:', error);
            return task;
        }
    }

    async cancelTask(sessionId: string): Promise<CosmoAgentTask> {
        const response = await cosmoAPI.cancelAgentSession(sessionId);
        const task: CosmoAgentTask = {
            sessionId: response.id,
            prompt: response.goal || '',
            status: response.status,
            backend: (response.backend_resolved || 'server') as CosmoAgentBackend,
            answer: response.answer || '',
            imageUrl: response.image_url,
            plan: response.plan || [],
            toolResults: response.tool_results || [],
            citations: response.citations || [],
            updatedAt: response.updated_at,
            baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://shubhjn-cosmo-ai.hf.space',
        };
        await persistTask(task);
        return task;
    }

    async clearTask(): Promise<void> {
        try {
            await AsyncStorage.removeItem(ACTIVE_TASK_KEY);
        } catch (error) {
            console.error('Failed to clear current agent task:', error);
        }
    }

    async clearHistory(): Promise<void> {
        try {
            await AsyncStorage.multiRemove([ACTIVE_TASK_KEY, TASK_HISTORY_KEY]);
        } catch (error) {
            console.error('Failed to clear agent history:', error);
        }
    }
}

export const agentMode = new AgentModeService();
export default agentMode;
