/**
 * Root App Component with Server Keepalive
 * Add this to your main app component (_layout.tsx or App.tsx)
 */

/**
 * USAGE EXAMPLE 1: In Root Layout (_layout.tsx)
 */
/*
import { useServerKeepalive } from '@/hooks';

export default function RootLayout() {
  // Enable server keepalive with 30-minute intervals
  const { lastPing, pingCount, error } = useServerKeepalive({ 
    enabled: true,
    interval: 30 * 60 * 1000, // 30 minutes
    onSuccess: (data) => console.log('✅ Server pinged:', data),
    onError: (err) => console.error('❌ Ping failed:', err),
  });

  return (
    <Stack>
      {/* Your app navigation *\/}
    </Stack>
  );
}
*/

/**
 * USAGE EXAMPLE 2: Simple version (just ping, no state)
 */
/*
import { useSimpleKeepalive } from '@/hooks';

export default function App() {
  // Ping every 45 minutes
  useSimpleKeepalive(45);

  return <YourApp />;
}
*/

/**
 * USAGE EXAMPLE 3: Manual control
 */
/*
import { useServerKeepalive } from '@/hooks';

export default function SettingsScreen() {
  const { 
    isActive, 
    lastPing, 
    nextPing, 
    pingCount,
    start, 
    stop, 
    pingNow 
  } = useServerKeepalive({
    enabled: false, // Start manually
    interval: 60 * 60 * 1000, // 1 hour
  });

  return (
    <View>
      <Text>Status: {isActive ? 'Active' : 'Inactive'}</Text>
      <Text>Ping Count: {pingCount}</Text>
      <Text>Last Ping: {lastPing?.toLocaleTimeString()}</Text>
      <Text>Next Ping: {nextPing?.toLocaleTimeString()}</Text>
      
      <Button title="Start Keepalive" onPress={start} />
      <Button title="Stop Keepalive" onPress={stop} />
      <Button title="Ping Now" onPress={pingNow} />
    </View>
  );
}
*/

/**
 * RECOMMENDED SETUP:
 * 
 * 1. Add to app/_layout.tsx (root layout):
 */
/*
import { useSimpleKeepalive } from '@/hooks';

export default function RootLayout() {
  // Auto-ping every 30 minutes
  useSimpleKeepalive(30);
  
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
*/

/**
 * BENEFITS:
 * - Prevents HuggingFace server from sleeping
 * - Automatic app state handling (pauses when app backgrounds)
 * - Configurable intervals
 * - Error handling and retry logic
 * - Manual control available
 * - Centralized in hook for easy debugging
 */
