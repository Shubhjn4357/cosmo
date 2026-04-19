import { COSMO_API_URL } from '@/constants/Config';

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
    message: string;
}

export interface BusinessDiagnostics {
    filesystem?: {
        writable: boolean;
    };
    mythos?: {
        lesson_count: number;
    };
    audio?: {
        buffer_health: string;
    };
}

export type SessionUpdateMessage = 
    | { type: 'session_update'; payload: Partial<BusinessSession> }
    | { type: 'handoff_message'; payload: { messages: BusinessMessage[] } }
    | { type: 'mission_resumed'; payload: { status: string } };

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
    consensus_votes?: Record<string, Record<string, boolean>>;
}

class BusinessAgentService {
    private userId: string = Math.random().toString(36).substring(7);

    private async getHeaders() {
        return {
            'Content-Type': 'application/json',
        };
    }

    async analyzeVoice(text: string): Promise<{ goal: string; company_context: string }> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/voice-intake`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ raw_text: text }),
        });
        if (!response.ok) throw new Error('Voice analysis failed');
        return response.json();
    }

    async launchSession(goal: string, context?: string): Promise<{ session_id: string; status: string }> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/launch`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ goal, company_context: context || '' }),
        });
        if (!response.ok) throw new Error('Launch session failed');
        return response.json();
    }

    async getSession(sessionId: string): Promise<BusinessSession & { is_running: boolean }> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}`, {
            headers,
        });
        if (!response.ok) throw new Error('Get session failed');
        return response.json();
    }

    async sendHandoff(sessionId: string, message: string): Promise<{ status: string; messages: BusinessMessage[] }> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}/handoff`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ message, user_id: this.userId }),
        });
        if (!response.ok) throw new Error('Send handoff failed');
        return response.json();
    }

    async castVote(sessionId: string, msgId: string, agree: boolean): Promise<{ status: string; consensus: boolean }> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}/vote`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ user_id: this.userId, msg_id: msgId, agree }),
        });
        if (!response.ok) throw new Error('Cast vote failed');
        return response.json();
    }
    
    getUserId(): string {
        return this.userId;
    }

    async triggerDistillation(steps: number = 150): Promise<DistillationResult> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/distill?steps=${steps}`, {
            method: 'POST',
            headers,
        });
        if (!response.ok) throw new Error('Distillation failed');
        return response.json();
    }

    async triggerGlobalSync(): Promise<SyncResult> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/sync-global`, {
            method: 'POST',
            headers,
        });
        if (!response.ok) throw new Error('Global sync failed');
        return response.json();
    }

    async listSessions(limit: number = 20): Promise<{ sessions: BusinessSession[]; count: number }> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/sessions?limit=${limit}`, {
            headers,
        });
        if (!response.ok) throw new Error('List sessions failed');
        return response.json();
    }

    async getReport(sessionId: string): Promise<{ report: string }> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}/report`, {
            headers,
        });
        if (!response.ok) throw new Error('Get report failed');
        return response.json();
    }

    async resumeSession(sessionId: string): Promise<{ status: string }> {
        const headers = await this.getHeaders();
        const response = await fetch(`${COSMO_API_URL}/api/cosmo/business/sessions/${sessionId}/resume`, {
            method: 'POST',
            headers,
        });
        if (!response.ok) throw new Error('Resume session failed');
        return response.json();
    }

    subscribeToSessionUpdates(sessionId: string, onUpdate: (data: SessionUpdateMessage) => void): () => void {
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
export default businessAgentService;
