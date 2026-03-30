import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';

/**
 * Dev Mode Subscription Manager
 * 
 * Toggle IS_DEV_MODE to switch between mock and real payments
 * When ready to launch, set IS_DEV_MODE = false and implement RevenueCat
 */

// ⚙️ CHANGE THIS TO FALSE WHEN READY FOR PRODUCTION
export const IS_DEV_MODE = true;

const STORAGE_KEY = 'is_pro_user';

/**
 * Check if user has Pro subscription
 */
export const checkProStatus = async (): Promise<boolean> => {
  try {
    if (IS_DEV_MODE) {
      // Dev mode: Check local storage
      const status = await AsyncStorage.getItem(STORAGE_KEY);
      return status === 'true';
    } else {
      // Production: RevenueCat code goes here
      // TODO: Implement RevenueCat when ready
      return false;
    }
  } catch (error) {
    console.error('Error checking pro status:', error);
    return false;
  }
};

/**
 * Purchase Pro subscription
 */
export const buySubscription = async (): Promise<boolean> => {
  try {
    if (IS_DEV_MODE) {
      // Dev mode: Fake purchase
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
      
      if (Platform.OS !== 'web') {
        Alert.alert(
          '🎉 Dev Mode',
          'Mock purchase successful! You are now a Pro user.',
          [{ text: 'OK' }]
        );
      }
      
      return true;
    } else {
      // Production: RevenueCat purchase flow
      // TODO: Implement RevenueCat when ready
      return false;
    }
  } catch (error) {
    console.error('Error during purchase:', error);
    return false;
  }
};

/**
 * Restore Pro subscription (for "Restore Purchase" button)
 */
export const restorePurchases = async (): Promise<boolean> => {
  try {
    if (IS_DEV_MODE) {
      // Dev mode: Check if already Pro
      const isPro = await checkProStatus();
      
      if (Platform.OS !== 'web') {
        if (isPro) {
          Alert.alert('✅ Dev Mode', 'Pro status already active!');
        } else {
          Alert.alert('ℹ️ Dev Mode', 'No purchases to restore.');
        }
      }
      
      return isPro;
    } else {
      // Production: RevenueCat restore
      // TODO: Implement RevenueCat when ready
      return false;
    }
  } catch (error) {
    console.error('Error restoring purchases:', error);
    return false;
  }
};

/**
 * Enable Pro (Dev Mode Only)
 * For testing purposes - adds a toggle in settings
 */
export const enableProDevMode = async (): Promise<void> => {
  if (IS_DEV_MODE) {
    await AsyncStorage.setItem(STORAGE_KEY, 'true');
  }
};

/**
 * Disable Pro (Dev Mode Only)
 * For testing purposes - adds a toggle in settings
 */
export const disableProDevMode = async (): Promise<void> => {
  if (IS_DEV_MODE) {
    await AsyncStorage.setItem(STORAGE_KEY, 'false');
  }
};

/**
 * Get subscription info
 */
export const getSubscriptionInfo = async () => {
  const isPro = await checkProStatus();
  
  return {
    isPro,
    tier: isPro ? 'pro' : 'free',
    tokensLimit: isPro ? 1000 : 20,
    features: isPro 
      ? ['1000 tokens/day', 'All AI models', 'Priority support', 'Vision generation', 'All personalities']
      : ['20 tokens/day', 'Basic features', 'Limited models']
  };
};
