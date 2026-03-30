/**
 * Swipe to Reload Hook
 * Pull-to-refresh functionality for chat screens
 */

import { useState, useCallback } from 'react';
import { RefreshControl } from 'react-native';
import { useM3Colors } from '@/constants/material3';

export function useSwipeToReload(onReload: () => Promise<void> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const m3Colors = useM3Colors();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onReload();
    } catch (error) {
      console.error('Reload error:', error);
    } finally {
      setRefreshing(false);
    }
  }, [onReload]);

  return {
    refreshing,
    onRefresh,
  };
}

export default useSwipeToReload;
