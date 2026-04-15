import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cosmo Storage - Resilient AsyncStorage Wrapper
 * Prevents concurrent write locks and handles size errors gracefully.
 * Vital for preventing crashes during heavy offline sync.
 */

class CosmoStorage {
    private queue: Promise<any> = Promise.resolve();

    /**
     * Executes a storage operation within a sequential queue to prevent multi-write crashes.
     */
    private async enqueue<T>(op: () => Promise<T>): Promise<T> {
        this.queue = this.queue.then(() => op());
        return this.queue;
    }

    async getItem<T>(key: string): Promise<T | null> {
        try {
            const value = await AsyncStorage.getItem(key);
            if (!value) return null;
            return JSON.parse(value) as T;
        } catch (err) {
            console.error(`[CosmoStorage] Read Error (${key}):`, err);
            return null;
        }
    }

    async setItem<T>(key: string, value: T): Promise<void> {
        return this.enqueue(async () => {
            try {
                const json = JSON.stringify(value);
                await AsyncStorage.setItem(key, json);
            } catch (err) {
                console.error(`[CosmoStorage] Write Error (${key}):`, err);
                // If storage is full, we log it. In a real app, we might purge old cache here.
            }
        });
    }

    async removeItem(key: string): Promise<void> {
        return this.enqueue(async () => {
            try {
                await AsyncStorage.removeItem(key);
            } catch (err) {
                console.error(`[CosmoStorage] Remove Error (${key}):`, err);
            }
        });
    }

    async clearNamespace(prefix: string): Promise<void> {
        return this.enqueue(async () => {
            try {
                const keys = await AsyncStorage.getAllKeys();
                const toRemove = keys.filter(k => k.startsWith(prefix));
                if (toRemove.length > 0) {
                    await AsyncStorage.multiRemove(toRemove);
                }
            } catch (err) {
                console.error(`[CosmoStorage] Clear Error (${prefix}):`, err);
            }
        });
    }
}

export const storage = new CosmoStorage();
