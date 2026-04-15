/**
 * Sleep Prevention Hook
 * Keeps device awake during AI generation
 */

import { useEffect } from 'react';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * Hook to prevent device sleep during active operations
 * Automatically activates when isActive is true
 */
export function useKeepAwake(isActive: boolean) {
  useEffect(() => {
    if (isActive) {
      activateKeepAwake();
      console.log('🔒 Keep awake activated');
    } else {
      deactivateKeepAwake();
      console.log('🔓 Keep awake deactivated');
    }

    return () => {
      deactivateKeepAwake();
    };
  }, [isActive]);
}

export default useKeepAwake;
