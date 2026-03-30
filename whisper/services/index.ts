/**
 * Whisper App - Services Index
 * Re-exports all service modules
 */

// API
export { whisperAPI, type LLMModel, type ImageModel, type HealthStatus } from './api';

// Profile API (Server-side)
export {
    authAPI,
    profileAPI,
    historyAPI,
    subscriptionAPI,
    type UserProfile,
    type ChatHistory,
    type AuthSession,
} from './profileAPI';

// Text-to-Speech
export { ttsService, useTTS } from './tts';

// Training Sync Service
export { trainingSyncService } from './trainingSyncService';
export type { TrainingPair } from './trainingSyncService';


// Camera & Image Picker
export {
    takePhoto,
    pickFromGallery,
    pickImage,
    imageToBase64,
    formatFileSize,
} from './camera';
export type { ImageResult, CameraOptions } from './camera';

// Task Queue
export { taskQueue, useTaskQueue } from './taskQueue';
export type { QueuedTask, TaskStatus, TaskType } from './taskQueue';

// Permissions
export {
    requestAllPermissions,
    requestCameraPermission,
    requestMediaLibraryPermission,
    requestNotificationPermission,
    getPermissionStatus,
    hasRequestedPermissions,
    canUseCamera,
    canUseGallery,
    canReceiveNotifications,
    openSettings,
} from './permissions';
export type { PermissionStatus } from './permissions';

// Roleplay Service
export { roleplayService, BUILT_IN_CHARACTERS } from './roleplayService';
export type { CharacterPersonality, RoleplayMessage, RoleplaySession, Memory } from './roleplayService';
