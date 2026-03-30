/**
 * Stock Avatars for Whisper App
 */

export const STOCK_AVATARS = [
    { id: 'face-1', source: require('@/assets/stock/face-1.webp') },
    { id: 'face-2', source: require('@/assets/stock/face-2.webp') },
    { id: 'face-3', source: require('@/assets/stock/face-3.webp') },
    { id: 'face-4', source: require('@/assets/stock/face-4.webp') },
    { id: 'face-5', source: require('@/assets/stock/face-5.webp') },
    { id: 'face-6', source: require('@/assets/stock/face-6.webp') },
];

/**
 * Get avatar source from profile avatar_url
 */
// Get avatar source from profile avatar_url
export const getAvatarSource = (avatarUrl: string | null | undefined) => {
    if (!avatarUrl) return null;

    const url = avatarUrl.trim();

    // Check for stock avatar prefix
    if (url.startsWith('stock:')) {
        const id = url.replace('stock:', '');
        const avatar = STOCK_AVATARS.find(a => a.id === id);
        return avatar?.source || null;
    }

    // Return as URI for external URLs (must be http/https/file)
    if (url.startsWith('http') || url.startsWith('file')) {
        return { uri: url };
    }

    return null;
};

/**
 * Get random avatar ID
 */
export const getRandomAvatarId = () => {
    const index = Math.floor(Math.random() * STOCK_AVATARS.length);
    return STOCK_AVATARS[index].id;
};
