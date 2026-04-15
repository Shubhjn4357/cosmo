/**
 * Cosmo AI — Offline-First Sync Service
 * =======================================
 * Strategy:
 *  1. ALL operations write to CosmoStorage immediately (offline-safe)
 *  2. A queue of pending sync operations is persisted
 *  3. When network comes online, queue is drained and sent to server
 *  4. Conflicts resolved by last-write-wins (client timestamp)
 *
 * Covers: personality, chat history, business sessions, settings
 */

import { storage } from '@/utils/storage';
import NetInfo from '@react-native-community/netinfo';

// ─── Queue Item ───────────────────────────────────────────────────────────────

interface SyncQueueItem {
    id: string;
    endpoint: string;
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    payload: unknown;
    timestamp: number;
    retries: number;
    tag: string; // e.g. 'personality', 'chat', 'business'
}

const SYNC_QUEUE_KEY = '@cosmo_sync_queue';
const MAX_RETRIES = 5;
const SYNC_INTERVAL_MS = 15_000; // 15s while online

// ─── State ────────────────────────────────────────────────────────────────────

let _baseUrl = '';
let _syncTimer: ReturnType<typeof setInterval> | null = null;
let _isSyncing = false;
let _isOnline = false;
let _listeners: Array<(online: boolean) => void> = [];

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initOfflineSync(baseUrl: string): void {
    _baseUrl = baseUrl;

    NetInfo.addEventListener((state) => {
        const wasOnline = _isOnline;
        _isOnline = state.isConnected === true && state.isInternetReachable !== false;

        _listeners.forEach((cb) => cb(_isOnline));

        if (!wasOnline && _isOnline) {
            // Just came online — drain the queue immediately
            void drainSyncQueue();
            if (!_syncTimer) {
                _syncTimer = setInterval(() => void drainSyncQueue(), SYNC_INTERVAL_MS);
            }
        }

        if (wasOnline && !_isOnline && _syncTimer) {
            clearInterval(_syncTimer);
            _syncTimer = null;
        }
    });

    // Bootstrap check
    NetInfo.fetch().then((state) => {
        _isOnline = state.isConnected === true && state.isInternetReachable !== false;
        if (_isOnline) {
            void drainSyncQueue();
            _syncTimer = setInterval(() => void drainSyncQueue(), SYNC_INTERVAL_MS);
        }
    });
}

export function onNetworkChange(cb: (online: boolean) => void): () => void {
    _listeners.push(cb);
    return () => { _listeners = _listeners.filter((l) => l !== cb); };
}

export function getIsOnline(): boolean {
    return _isOnline;
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

export async function enqueueSync(
    tag: string,
    endpoint: string,
    method: SyncQueueItem['method'],
    payload: unknown,
): Promise<void> {
    const item: SyncQueueItem = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        endpoint,
        method,
        payload,
        timestamp: Date.now(),
        retries: 0,
        tag,
    };

    const queue = await _loadQueue();
    // Deduplicate by tag — keep only latest for the same tag
    const deduped = queue.filter((q) => q.tag !== tag);
    deduped.push(item);
    await _saveQueue(deduped);

    // If online, drain immediately
    if (_isOnline) {
        void drainSyncQueue();
    }
}

// ─── Drain ────────────────────────────────────────────────────────────────────

async function drainSyncQueue(): Promise<void> {
    if (_isSyncing || !_isOnline || !_baseUrl) return;
    _isSyncing = true;

    try {
        const queue = await _loadQueue();
        if (!queue.length) return;

        const remaining: SyncQueueItem[] = [];

        for (const item of queue) {
            try {
                const res = await fetch(`${_baseUrl}${item.endpoint}`, {
                    method: item.method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item.payload),
                });

                if (!res.ok && res.status !== 409) {
                    // 409 Conflict = server already has newer data, discard
                    if (item.retries < MAX_RETRIES) {
                        remaining.push({ ...item, retries: item.retries + 1 });
                    }
                    // Otherwise discard silently after max retries
                }
                // Success — item removed from queue
            } catch {
                if (item.retries < MAX_RETRIES) {
                    remaining.push({ ...item, retries: item.retries + 1 });
                }
            }
        }

        await _saveQueue(remaining);
    } finally {
        _isSyncing = false;
    }
}

async function _loadQueue(): Promise<SyncQueueItem[]> {
    const data = await storage.getItem<SyncQueueItem[]>(SYNC_QUEUE_KEY);
    return data ?? [];
}

async function _saveQueue(queue: SyncQueueItem[]): Promise<void> {
    await storage.setItem(SYNC_QUEUE_KEY, queue);
}

// ─── Generic Offline-Safe Storage Helpers ────────────────────────────────────

/**
 * Save any data locally, then enqueue a cloud sync when online.
 */
export async function saveOfflineFirst<T>(
    localKey: string,
    data: T,
    syncEndpoint: string,
    syncMethod: SyncQueueItem['method'] = 'POST',
    syncTag?: string,
): Promise<void> {
    // Always write locally first
    await storage.setItem(localKey, data);

    // Enqueue cloud sync
    await enqueueSync(
        syncTag ?? localKey,
        syncEndpoint,
        syncMethod,
        data,
    );
}

/**
 * Load data — prefer local, fall back to cloud fetch if local is empty and online.
 */
export async function loadOfflineFirst<T>(
    localKey: string,
    cloudEndpoint?: string,
    fallback?: T,
): Promise<T | undefined> {
    try {
        const local = await storage.getItem<T>(localKey);
        if (local) {
            return local;
        }

        if (cloudEndpoint && _isOnline && _baseUrl) {
            const res = await fetch(`${_baseUrl}${cloudEndpoint}`);
            if (res.ok) {
                const data = (await res.json()) as T;
                await storage.setItem(localKey, data);
                return data;
            }
        }

        return fallback;
    } catch {
        return fallback;
    }
}

export async function getPendingSyncCount(): Promise<number> {
    const queue = await _loadQueue();
    return queue.length;
}
