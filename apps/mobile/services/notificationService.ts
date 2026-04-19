/**
 * Cosmo App - Notification Service
 * Handles push notifications with permissions.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

class NotificationService {
    private hasRequestedPermission = false;

    async requestPermissions(): Promise<boolean> {
        if (this.hasRequestedPermission) {
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            return existingStatus === 'granted';
        }

        const { status } = await Notifications.requestPermissionsAsync();
        this.hasRequestedPermission = true;

        if (status !== 'granted') {
            console.log('Notification permission not granted');
            return false;
        }

        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'Default',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF231F7C',
            });
        }

        return true;
    }

    async hasPermissions(): Promise<boolean> {
        const { status } = await Notifications.getPermissionsAsync();
        return status === 'granted';
    }

    async scheduleNotification(
        title: string,
        body: string,
        trigger?: Notifications.NotificationTriggerInput
    ): Promise<string | null> {
        const hasPermission = await this.hasPermissions();
        if (!hasPermission) {
            const granted = await this.requestPermissions();
            if (!granted) {
                return null;
            }
        }

        try {
            const id = await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    sound: true,
                },
                trigger: trigger || null,
            });
            return id;
        } catch (error) {
            console.error('Failed to schedule notification:', error);
            return null;
        }
    }

    async cancelNotification(notificationId: string): Promise<void> {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
    }

    async cancelAllNotifications(): Promise<void> {
        await Notifications.cancelAllScheduledNotificationsAsync();
    }

    async scheduleDailyReminder(hour: number = 9, minute: number = 0): Promise<string | null> {
        const trigger: Notifications.CalendarTriggerInput = {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            hour,
            minute,
            repeats: true,
        };

        return this.scheduleNotification(
            'Cosmo AI',
            'Don\'t forget to chat with Cosmo today!',
            trigger
        );
    }

    async isFirstLaunch(): Promise<boolean> {
        const hasLaunched = await AsyncStorage.getItem('@first_launch');
        if (!hasLaunched) {
            await AsyncStorage.setItem('@first_launch', 'true');
            return true;
        }
        return false;
    }
}

export const notificationService = new NotificationService();
export default notificationService;
