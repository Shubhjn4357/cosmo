/**
 * Whisper AI - Agent Mode Service
 * Handles task-oriented AI interactions with planning and tool execution
 */

import { whisperAPI } from './api';
import { localLLM } from './localLLM';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AgentTask {
    id: string;
    goal: string;
    status: 'pending' | 'planning' | 'executing' | 'complete' | 'failed';
    plan: AgentStep[];
    results: Record<string, string>;
    createdAt: Date;
}

export interface AgentStep {
    id: string;
    description: string;
    tool: 'chat' | 'image' | 'search' | 'analyze' | 'code';
    params: Record<string, any>;
    status: 'pending' | 'running' | 'complete' | 'failed';
    result?: string;
}

export interface AgentContext {
    conversationHistory: { role: 'user' | 'assistant'; content: string }[];
    currentTask: AgentTask | null;
    preferences: Record<string, any>;
}

const AGENT_CONTEXT_KEY = 'agent_context';

class AgentModeService {
    private context: AgentContext = {
        conversationHistory: [],
        currentTask: null,
        preferences: {},
    };

    constructor() {
        this.loadContext();
    }

    private async loadContext() {
        try {
            const data = await AsyncStorage.getItem(AGENT_CONTEXT_KEY);
            if (data) {
                this.context = JSON.parse(data);
            }
        } catch (e) {
            console.error('Failed to load agent context:', e);
        }
    }

    private async saveContext() {
        try {
            await AsyncStorage.setItem(AGENT_CONTEXT_KEY, JSON.stringify(this.context));
        } catch (e) {
            console.error('Failed to save agent context:', e);
        }
    }

    async think(userMessage: string): Promise<string> {
        // Add to conversation history
        this.context.conversationHistory.push({ role: 'user', content: userMessage });

        // Generate response with task understanding
        const systemPrompt = `You are Whisper, an AI assistant that can help with tasks.
When the user asks something complex, break it down into steps.
Available tools: chat, image generation, file analysis, web search.
If you need to use a tool, say "[TOOL:toolname] description".
Be helpful and proactive.`;

        const prompt = `${systemPrompt}\n\nConversation:\n${this.context.conversationHistory
            .slice(-10)
            .map(m => `${m.role === 'user' ? 'User' : 'Whisper'}: ${m.content}`)
            .join('\n')}\nWhisper:`;

        let response: string;

        // Try local model first, fall back to server
        if (localLLM.isLoaded()) {
            response = await localLLM.generate(prompt);
        } else {
            try {
                const result = await whisperAPI.chat({ message: userMessage, isLocal: true });
                response = result.response;
            } catch {
                response = "I'm having trouble connecting. Please check your internet connection.";
            }
        }

        // Add response to history
        this.context.conversationHistory.push({ role: 'assistant', content: response });

        // Keep history manageable
        if (this.context.conversationHistory.length > 20) {
            this.context.conversationHistory = this.context.conversationHistory.slice(-20);
        }

        await this.saveContext();

        // Parse for tool calls
        const toolMatch = response.match(/\[TOOL:(\w+)\]\s*(.+)/);
        if (toolMatch) {
            const [, tool, description] = toolMatch;
            return await this.executeTool(tool, description, response);
        }

        return response;
    }

    private async executeTool(tool: string, description: string, originalResponse: string): Promise<string> {
        switch (tool.toLowerCase()) {
            case 'image':
                return `${originalResponse}\n\n💡 Tip: Go to the Create tab and use: "${description}"`;

            case 'search':
                return `${originalResponse}\n\n🔍 I would search for: "${description}" (Web search coming soon)`;

            case 'analyze':
                return `${originalResponse}\n\n📄 Go to Files tab to analyze documents`;

            case 'code':
                return `${originalResponse}\n\n💻 Code generation coming soon`;

            default:
                return originalResponse;
        }
    }

    async createTask(goal: string): Promise<AgentTask> {
        const task: AgentTask = {
            id: Date.now().toString(),
            goal,
            status: 'planning',
            plan: [],
            results: {},
            createdAt: new Date(),
        };

        this.context.currentTask = task;
        await this.saveContext();

        // Generate plan
        const planPrompt = `Break down this task into steps: "${goal}"
Respond with numbered steps only, one per line.`;

        let planText: string;
        if (localLLM.isLoaded()) {
            planText = await localLLM.generate(planPrompt);
        } else {
            const result = await whisperAPI.chat({ message: planPrompt, isLocal: true });
            planText = result.response;
        }

        // Parse steps
        const stepLines = planText.split('\n').filter(line => line.match(/^\d+\./));
        task.plan = stepLines.map((line, i) => ({
            id: `step-${i}`,
            description: line.replace(/^\d+\.\s*/, ''),
            tool: 'chat',
            params: {},
            status: 'pending' as const,
        }));

        task.status = 'pending';
        await this.saveContext();

        return task;
    }

    getCurrentTask(): AgentTask | null {
        return this.context.currentTask;
    }

    async clearTask(): Promise<void> {
        this.context.currentTask = null;
        await this.saveContext();
    }

    async clearHistory(): Promise<void> {
        this.context.conversationHistory = [];
        await this.saveContext();
    }
}

export const agentMode = new AgentModeService();
export default agentMode;
