import { Stack } from 'expo-router';
import { AppHeader } from '@/components/app-header';
import { Platform, StyleSheet, View } from 'react-native';
import { colors, layout, motion } from '@/theme';

/**
 * Signed-in area: the tab navigator, plus feature screens pushed over it. Pushed screens share
 * one header (AppHeader: back arrow + title, inset applied once), set here so they all match.
 * The tabs draw their own headers (same component), so the stack hides its header for "(tabs)".
 */
export default function AppLayout() {
  return (
    <View style={styles.backdrop}>
      <View style={styles.column}>
        <AppStack />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', backgroundColor: colors.ground },
  // Tablets: one centred, readable column instead of stretching every screen edge to edge.
  column: { flex: 1, width: '100%', maxWidth: layout.maxContent },
});

function AppStack() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, route, back, navigation }) => (
          <AppHeader
            title={typeof options.title === 'string' ? options.title : route.name}
            onBack={back ? () => navigation.goBack() : undefined}
          />
        ),
        contentStyle: { backgroundColor: colors.ground },
        // Native slide: iOS push with swipe-back, Android shared-axis style.
        animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
        animationDuration: motion.base,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="coming-soon/[feature]" />
      <Stack.Screen name="masters/[kind]/index" />
      <Stack.Screen name="masters/[kind]/[id]" />
      <Stack.Screen name="masters/[kind]/form" />
      <Stack.Screen name="products/index" options={{ title: 'Products' }} />
      <Stack.Screen name="dcr/form" />
      <Stack.Screen name="tour-plan/form" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="leave/index" />
      <Stack.Screen name="leave/apply" />
      <Stack.Screen name="expenses/index" />
      <Stack.Screen name="expenses/[id]" />
      <Stack.Screen name="approvals/tp/[id]" />
      <Stack.Screen name="approvals/index" />
      <Stack.Screen name="approvals/dcr/[id]" />
    </Stack>
  );
}
