/**
 * Cosmo AI - Task Queue Service
 * Background task management with persistence and push notifications.
 * Uses CosmoStorage for resilient persistence.
 */

import { storage } from '@/utils/storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { cosmoAPI } from './api';

// Storage key
const TASK_QUEUE_KEY = '@cosmo_task_queue';

// Task status types
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type TaskType = 'chat' | 'image' | 'analysis';

// Task interface
export interface QueuedTask {
    id: string;
    type: TaskType;
    status: TaskStatus;
    data: Record<string, any>;
    result?: any;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    retryCount: number;
    maxRetries: number;
}

// Configure notification handler
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

class TaskQueueService {
    private queue: QueuedTask[] = [];
    private isProcessing: boolean = false;
    private listeners: Map<string, (task: QueuedTask) => void> = new Map();

    constructor() {
        this.loadQueue();
        this.setupNotifications();
    }

    /**
     * Setup push notifications
     */
    private async setupNotifications() {
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('tasks', {
                name: 'Task Updates',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#8b5cf6',
            });
        }

        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
            console.log('Notification permission not granted');
        }
    }

    /**
     * Load queue from storage
     */
    private async loadQueue() {
        try {
            const saved = await storage.getItem<QueuedTask[]>(TASK_QUEUE_KEY);
            if (saved) {
                this.queue = saved;
                // Resume any pending tasks
                this.processQueue();
            }
        } catch (error) {
            console.error('Error loading task queue:', error);
        }
    }

    /**
     * Save queue to storage
     */
    private async saveQueue() {
        try {
            await storage.setItem(TASK_QUEUE_KEY, this.queue);
        } catch (error) {
            console.error('Error saving task queue:', error);
        }
    }

    /**
     * Generate unique task ID
     */
    private generateId(): string {
        return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Add task to queue
     */
    async addTask(type: TaskType, data: Record<string, any>): Promise<string> {
        const task: QueuedTask = {
            id: this.generateId(),
            type,
            status: 'pending',
            data,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            retryCount: 0,
            maxRetries: 3,
        };

        this.queue.push(task);
        await this.saveQueue();

        // Start processing
        this.processQueue();

        return task.id;
    }

    /**
     * Process queue
     */
    private async processQueue() {
        if (this.isProcessing) return;

        const pendingTask = this.queue.find(t => t.status === 'pending');
        if (!pendingTask) return;

        this.isProcessing = true;

        try {
            await this.executeTask(pendingTask);
        } finally {
            this.isProcessing = false;
            // Check for more tasks
            this.processQueue();
        }
    }

    /**
     * Execute a single task
     */
    private async executeTask(task: QueuedTask) {
        task.status = 'processing';
        task.updatedAt = new Date().toISOString();
        await this.saveQueue();
        this.notifyListeners(task);

        try {
            let result: any;

            switch (task.type) {
                case 'chat':
                    result = await this.executeChatTask(task.data);
                    break;
                case 'image':
                    result = await this.executeImageTask(task.data);
                    break;
                case 'analysis':
                    result = await this.executeAnalysisTask(task.data);
                    break;
                default:
                    throw new Error(`Unknown task type: ${task.type}`);
            }

            task.status = 'completed';
            task.result = result;
            task.completedAt = new Date().toISOString();

            // Send success notification
            await this.sendNotification(
                'Task Completed',
                `Your ${task.type} task has finished.`,
                { taskId: task.id }
            );
        } catch (error: any) {
            task.retryCount++;

            if (task.retryCount < task.maxRetries) {
                task.status = 'pending'; // Retry
            } else {
                task.status = 'failed';
                task.error = error.message;

                // Send failure notification
                await this.sendNotification(
                    'Task Failed',
                    `Your ${task.type} task failed: ${error.message}`,
                    { taskId: task.id }
                );
            }
        }

        task.updatedAt = new Date().toISOString();
        await this.saveQueue();
        this.notifyListeners(task);
    }

    /**
     * Execute chat task
     */
    private async executeChatTask(data: Record<string, any>) {
        const response = await cosmoAPI.chat({
            message: data.message || '',
            useRAG: data.useRag,
            temperature: data.temperature,
            isLocal: data.isLocal ?? true,
            userId: data.userId,
            sessionId: data.sessionId,
        });
        return response;
    }

    /**
     * Execute image generation task
     */
    private async executeImageTask(data: Record<string, any>) {
        const response = await cosmoAPI.generateImage({
            prompt: data.prompt || '',
            width: data.width,
            height: data.height,
            modelId: data.modelId,
            isLocal: data.isLocal ?? false,
            userId: data.userId,
            sessionId: data.sessionId,
        });
        return response;
    }

    /**
     * Execute file analysis task
     */
    private async executeAnalysisTask(data: Record<string, any>) {
        const response = await cosmoAPI.analyzeFile(
            { uri: data.uri, name: data.name, type: data.type },
            data.question || 'Summarize this document'
        );
        return response;
    }

    /**
     * Send push notification
     */
    private async sendNotification(title: string, body: string, data: Record<string, any>) {
        try {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    data,
                    sound: true,
                },
                trigger: null, // Immediate
            });
        } catch (error) {
            console.error('Error sending notification:', error);
        }
    }

    /**
     * Get all tasks
     */
    getTasks(): QueuedTask[] {
        return [...this.queue];
    }

    /**
     * Get task by ID
     */
    getTask(id: string): QueuedTask | undefined {
        return this.queue.find(t => t.id === id);
    }

    /**
     * Get pending tasks
     */
    getPendingTasks(): QueuedTask[] {
        return this.queue.filter(t => t.status === 'pending' || t.status === 'processing');
    }

    /**
     * Get completed tasks
     */
    getCompletedTasks(): QueuedTask[] {
        return this.queue.filter(t => t.status === 'completed');
    }

    /**
     * Retry failed task
     */
    async retryTask(id: string): Promise<boolean> {
        const task = this.queue.find(t => t.id === id);
        if (!task || task.status !== 'failed') return false;

        task.status = 'pending';
        task.retryCount = 0;
        task.error = undefined;
        task.updatedAt = new Date().toISOString();

        await this.saveQueue();
        this.processQueue();

        return true;
    }

    /**
     * Cancel task
     */
    async cancelTask(id: string): Promise<boolean> {
        const index = this.queue.findIndex(t => t.id === id);
        if (index === -1) return false;

        const task = this.queue[index];
        if (task.status === 'processing') {
            return false; // Can't cancel processing task
        }

        this.queue.splice(index, 1);
        await this.saveQueue();

        return true;
    }

    /**
     * Clear completed tasks
     */
    async clearCompleted(): Promise<void> {
        this.queue = this.queue.filter(t => t.status !== 'completed');
        await this.saveQueue();
    }

    /**
     * Subscribe to task updates
     */
    subscribe(taskId: string, callback: (task: QueuedTask) => void) {
        this.listeners.set(taskId, callback);
        return () => this.listeners.delete(taskId);
    }

    /**
     * Notify listeners
     */
    private notifyListeners(task: QueuedTask) {
        const listener = this.listeners.get(task.id);
        if (listener) {
            listener(task);
        }
    }
}

// Singleton instance
export const taskQueue = new TaskQueueService();

/**
 * Hook for task queue
 */
import { useState, useEffect, useCallback } from 'react';

export function useTaskQueue() {
    const [tasks, setTasks] = useState<QueuedTask[]>([]);
    const [pendingCount, setPendingCount] = useState(0);

    useEffect(() => {
        const updateTasks = () => {
            setTasks(taskQueue.getTasks());
            setPendingCount(taskQueue.getPendingTasks().length);
        };

        // Initial load
        updateTasks();

        // Poll for updates (simple approach)
        const interval = setInterval(updateTasks, 1000);
        return () => clearInterval(interval);
    }, []);

    const addTask = useCallback(async (type: TaskType, data: Record<string, any>) => {
        return await taskQueue.addTask(type, data);
    }, []);

    const retryTask = useCallback(async (id: string) => {
        return await taskQueue.retryTask(id);
    }, []);

    const cancelTask = useCallback(async (id: string) => {
        return await taskQueue.cancelTask(id);
    }, []);

    return {
        tasks,
        pendingCount,
        addTask,
        retryTask,
        cancelTask,
        clearCompleted: taskQueue.clearCompleted.bind(taskQueue),
    };
}
