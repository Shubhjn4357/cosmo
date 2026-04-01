import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ModelType } from '@/types';

import {
    whisperAPI,
    type AgentPlanStep,
    type AgentRunResponse,
    type AgentToolResult,
} from './api';

const ACTIVE_TASK_KEY = '@whisper_agent_active_task';
const TASK_HISTORY_KEY = '@whisper_agent_task_history';
const MAX_TASK_HISTORY = 20;

export type WhisperAgentBackend = 'server' | 'self_learner' | 'cloud';

export interface WhisperAgentTask {
    sessionId: string;
    prompt: string;
    status: string;
    backend: WhisperAgentBackend;
    answer: string;
    imageUrl?: string | null;
    plan: AgentPlanStep[];
    toolResults: AgentToolResult[];
    citations: { source: string; score?: number; chunk?: number }[];
    updatedAt?: number;
}

export interface WhisperAgentRequest {
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

function resolveAgentBackend(mode: ModelType = 'server'): WhisperAgentBackend {
    if (mode === 'cloud') return 'cloud';
    if (mode === 'self-learner') return 'self_learner';
    return 'server';
}

function toTask(response: AgentRunResponse, prompt: string): WhisperAgentTask {
    return {
        sessionId: response.session_id,
        prompt,
        status: response.status,
        backend: response.backend as WhisperAgentBackend,
        answer: response.answer,
        imageUrl: response.image_url,
        plan: response.plan || [],
        toolResults: response.tool_results || [],
        citations: response.citations || [],
        updatedAt: response.updated_at,
    };
}

async function loadHistory(): Promise<WhisperAgentTask[]> {
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

async function persistTask(task: WhisperAgentTask): Promise<void> {
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
    resolveBackend(mode: ModelType = 'server'): WhisperAgentBackend {
        return resolveAgentBackend(mode);
    }

    async think(request: WhisperAgentRequest): Promise<WhisperAgentTask> {
        const response = await whisperAPI.runAgent({
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
        });

        const task = toTask(response, request.message);
        await persistTask(task);
        return task;
    }

    async createTask(request: WhisperAgentRequest): Promise<WhisperAgentTask> {
        return this.think(request);
    }

    async getCurrentTask(): Promise<WhisperAgentTask | null> {
        try {
            const raw = await AsyncStorage.getItem(ACTIVE_TASK_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.error('Failed to load current agent task:', error);
            return null;
        }
    }

    async getTaskHistory(): Promise<WhisperAgentTask[]> {
        return loadHistory();
    }

    async refreshTask(sessionId: string): Promise<WhisperAgentTask> {
        const response = await whisperAPI.getAgentSession(sessionId);
        const task: WhisperAgentTask = {
            sessionId: response.id,
            prompt: response.goal || '',
            status: response.status,
            backend: (response.backend_resolved || 'server') as WhisperAgentBackend,
            answer: response.answer || '',
            imageUrl: response.image_url,
            plan: response.plan || [],
            toolResults: response.tool_results || [],
            citations: response.citations || [],
            updatedAt: response.updated_at,
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
