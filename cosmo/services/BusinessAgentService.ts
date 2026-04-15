import axios from 'axios';
import { COSMO_API_URL } from '@/constants/Config';
import { getAuthToken } from './auth';

/**
 * Cosmo Business Agent Service
 * Handles autonomous business sessions, role-based task tracking, and report retrieval.
 */

export type EmployeeRole = 'ceo' | 'research' | 'analyst' | 'developer' | 'writer' | 'reviewer' | 'pre_flight';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_for_user';

export interface BusinessTask {
    id: string;
    title: string;
    description: string;
    assigned_to: EmployeeRole;
    status: TaskStatus;
    output?: string;
    review_notes?: string;
    started_at?: number;
    completed_at?: number;
    error?: string;
}

export interface BusinessMessage {
    role: string;
    text: string;
    ts: number;
    user_id?: string;
    agreements?: string[];
    is_consensus_reached?: boolean;
}

export interface DistillationResult {
    success: boolean;
    steps_completed: number;
    training_points_added: number;
    message: string;
}

export interface SyncResult {
    success: boolean;
    concepts_synced: number;
    graph_version: string;
}

export interface BusinessSession {
    id: string;
    goal: string;
    company_context?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_for_user';
    progress: number;
    tasks: BusinessTask[];
    final_report?: string;
    created_at: number;
    completed_at?: number;
    is_handoff_active?: boolean;
    messages?: BusinessMessage[];
    mission_tree?: string;
}

class BusinessAgentService {
    private userId: string = Math.random().toString(36).substring(7);

    private async getHeaders() {
        const token = await getAuthToken();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    async analyzeVoice(text: string): Promise<{ goal: string; company_context: string }> {
        const headers = await this.getHeaders();
        const res = await axios.post(`${COSMO_API_URL}/api/cosmo/business/voice-intake`, {
            raw_text: text,
        }, { headers });
        return res.data;
    }

    async launchSession(goal: string, context?: string): Promise<{ session_id: string; status: string }> {
        const headers = await this.getHeaders();
        const res = await axios.post(`${COSMO_API_URL}/api/cosmo/business/launch`, {
            goal,
            company_context: context || '',
        }, { headers });
        return res.data;
    }

    async getSession(sessionId: string): Promise<BusinessSession & { is_running: boolean }> {
        const headers = await this.getHeaders();
        const res = await axios.get(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}`, { headers });
        return res.data;
    }

    async sendHandoff(sessionId: string, message: string): Promise<{ status: string; messages: BusinessMessage[] }> {
        const headers = await this.getHeaders();
        const res = await axios.post(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}/handoff`, { 
            message,
            user_id: this.userId 
        }, { headers });
        return res.data;
    }

    async castVote(sessionId: string, msgId: string, agree: boolean): Promise<{ status: string; consensus: boolean }> {
        const headers = await this.getHeaders();
        const res = await axios.post(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}/vote`, {
            user_id: this.userId,
            msg_id: msgId,
            agree
        }, { headers });
        return res.data;
    }
    
    getUserId(): string {
        return this.userId;
    }

    async triggerDistillation(steps: number = 150): Promise<DistillationResult> {
        const headers = await this.getHeaders();
        const res = await axios.post(`${COSMO_API_URL}/api/cosmo/business/distill?steps=${steps}`, {}, { headers });
        return res.data;
    }

    async triggerGlobalSync(): Promise<SyncResult> {
        const headers = await this.getHeaders();
        const res = await axios.post(`${COSMO_API_URL}/api/cosmo/business/sync-global`, {}, { headers });
        return res.data;
    }

    async listSessions(limit: number = 20): Promise<{ sessions: BusinessSession[]; count: number }> {
        const headers = await this.getHeaders();
        const res = await axios.get(`${COSMO_API_URL}/api/cosmo/business/sessions`, { 
            params: { limit },
            headers 
        });
        return res.data;
    }

    async getReport(sessionId: string): Promise<{ report: string }> {
        const headers = await this.getHeaders();
        const res = await axios.get(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}/report`, { headers });
        return res.data;
    }

    async resumeSession(sessionId: string): Promise<{ status: string }> {
        const headers = await this.getHeaders();
        const res = await axios.post(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}/resume`, {}, { headers });
        return res.data;
    }

    subscribeToSessionUpdates(sessionId: string, onUpdate: (data: BusinessSession | { type: string; payload: BusinessMessage }) => void): () => void {
        const wsUrl = COSMO_API_URL.replace('http', 'ws') + `/api/cosmo/business/ws/${sessionId}`;
        const ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onUpdate(data);
            } catch (err) {
                console.error('Failed to parse WS message:', err);
            }
        };

        ws.onerror = (err) => {
            console.error('WS Connection error:', err);
        };

        return () => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };
    }
}

export const businessAgentService = new BusinessAgentService();
