import { Tabs } from 'expo-router';

/**
 * Tab Layout - Hidden Tab Bar
 * Navigation is now handled by the sidebar (GeminiSidebar)
 * Tab bar is completely hidden, but routes remain accessible
 */
export default function TabLayout() {

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                // Completely hide the tab bar - navigation via sidebar
                tabBarStyle: { display: 'none' },
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: 'Chat',
                }}
            />
            <Tabs.Screen
                name="image"
                options={{
                    title: 'Create',
                }}
            />
            <Tabs.Screen
                name="roleplay"
                options={{
                    title: 'Roleplay',
                }}
            />
            <Tabs.Screen
                name="faceswap"
                options={{
                    title: 'Face Swap',
                }}
            />
            <Tabs.Screen
                name="models"
                options={{
                    title: 'Models',
                }}
            />
            <Tabs.Screen
                name="files"
                options={{
                    href: null,
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: 'Settings',
                }}
            />
            <Tabs.Screen
                name="admin"
                options={{
                    href: null,
                }}
            />
        </Tabs>
    );
}


