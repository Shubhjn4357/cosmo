/**
 * Whisper App - History Sync Service
 * Offline-first sync of chat history with the Whisper server history API.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { historyAPI, ChatHistory } from './profileAPI';

const OFFLINE_QUEUE_KEY = 'Whisper_offline_sync_queue';
const LOCAL_HISTORY_KEY = 'Whisper_local_history';

export interface SyncQueueItem {
    id: string;
    action: 'create' | 'update' | 'delete';
    data: Partial<ChatHistory>;
    timestamp: string;
    retryCount: number;
}

class HistorySyncService {
    private syncQueue: SyncQueueItem[] = [];
    private isSyncing: boolean = false;
    private userId: string | null = null;

    constructor() {
        this.loadQueue();
        this.setupNetworkListener();
    }

    /**
     * Initialize with user ID
     */
    setUserId(userId: string | null) {
        this.userId = userId;
        if (userId) {
            this.processQueue();
        }
    }

    /**
     * Setup network state listener
     */
    private setupNetworkListener() {
        NetInfo.addEventListener((state) => {
            if (state.isConnected && this.userId) {
                this.processQueue();
            }
        });
    }

    /**
     * Load offline queue from storage
     */
    private async loadQueue() {
        try {
            const saved = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
            if (saved) {
                this.syncQueue = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Error loading sync queue:', error);
        }
    }

    /**
     * Save queue to storage
     */
    private async saveQueue() {
        try {
            await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.syncQueue));
        } catch (error) {
            console.error('Error saving sync queue:', error);
        }
    }

    /**
     * Add item to sync queue (for offline support)
     */
    async queueSync(action: 'create' | 'update' | 'delete', data: Partial<ChatHistory>) {
        const item: SyncQueueItem = {
            id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            action,
            data,
            timestamp: new Date().toISOString(),
            retryCount: 0,
        };

        this.syncQueue.push(item);
        await this.saveQueue();

        // Try to sync immediately if online
        this.processQueue();
    }

    /**
     * Process the sync queue
     */
    private async processQueue() {
        if (this.isSyncing || !this.userId || this.syncQueue.length === 0) {
            return;
        }

        const netState = await NetInfo.fetch();
        if (!netState.isConnected) {
            return;
        }

        this.isSyncing = true;

        try {
            const processedIds: string[] = [];

            for (const item of this.syncQueue) {
                try {
                    await this.processSyncItem(item);
                    processedIds.push(item.id);
                } catch (error) {
                    item.retryCount++;
                    if (item.retryCount >= 3) {
                        // Remove after 3 failed attempts
                        processedIds.push(item.id);
                        console.error('Sync item failed permanently:', error);
                    }
                }
            }

            // Remove processed items
            this.syncQueue = this.syncQueue.filter(item => !processedIds.includes(item.id));
            await this.saveQueue();
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Process a single sync item
     */
    private async processSyncItem(item: SyncQueueItem) {
        if (!this.userId) return;

        switch (item.action) {
            case 'create':
                await historyAPI.createChat(
                    this.userId,
                    item.data.title || 'New Chat',
                    item.data.messages || []
                );
                break;
            case 'update':
                if (item.data.id) {
                    await historyAPI.updateChat(item.data.id, item.data);
                }
                break;
            case 'delete':
                if (item.data.id) {
                    await historyAPI.deleteChat(item.data.id);
                }
                break;
        }
    }

    /**
     * Sync chat on completion
     */
    async syncChatCompletion(chatId: string, messages: any[], title?: string) {
        if (!this.userId) return;

        const chatData: Partial<ChatHistory> = {
            id: chatId,
            user_id: this.userId,
            messages,
            title: title || this.generateTitle(messages),
            updated_at: new Date().toISOString(),
        };

        await this.queueSync('update', chatData);
    }

    /**
     * Generate title from first message
     */
    private generateTitle(messages: any[]): string {
        const firstUserMessage = messages.find(m => m.role === 'user');
        if (firstUserMessage?.content) {
            const text = firstUserMessage.content;
            return text.length > 50 ? text.substring(0, 47) + '...' : text;
        }
        return 'New Chat';
    }

    /**
     * Delete chat with sync
     */
    async deleteChat(chatId: string) {
        if (!this.userId) return;
        await this.queueSync('delete', { id: chatId });
    }

    /**
     * Get pending sync count
     */
    getPendingSyncCount(): number {
        return this.syncQueue.length;
    }

    /**
     * Force sync now
     */
    async forceSync() {
        await this.processQueue();
    }
}

// Singleton instance
export const historySync = new HistorySyncService();
