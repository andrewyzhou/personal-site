import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View, useColorScheme } from "react-native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { sqlite } from "../db/client";
import { migrate } from "../db/migrate";
import { useColors } from "../components/theme";
import { REST_NOTIFICATION_KIND, initRestTimer } from "../components/workout/restTimer";
import { flushOnAppState } from "../lib/pending";
import { useAutoSync } from "../db/sync";

// foreground: the rest bar and a haptic already say it, so the rest alert
// stays quiet; anything else shows normally
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const rest = n.request.content.data?.kind === REST_NOTIFICATION_KIND;
    return { shouldShowBanner: !rest, shouldShowList: !rest, shouldPlaySound: !rest, shouldSetBadge: false };
  },
});

// migrations run once per js runtime, before any screen touches the db
let ready: Promise<void> | null = null;

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = useColors();
  const [state, setState] = useState<"loading" | "ready" | Error>("loading");
  // push-only sync on foreground + every few minutes; failures retry with backoff
  useAutoSync();

  useEffect(() => {
    ready ??= migrate(sqlite);
    ready.then(
      () => {
        initRestTimer();
        setState("ready");
      },
      (e: unknown) => setState(e instanceof Error ? e : new Error(String(e)))
    );
  }, []);

  // a weight typed just before locking the phone must land before ios can kill us
  useEffect(() => {
    const sub = AppState.addEventListener("change", flushOnAppState);
    return () => sub.remove();
  }, []);

  if (state !== "ready") {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        {state === "loading" ? (
          <ActivityIndicator />
        ) : (
          <Text style={{ color: c.danger }}>could not open the database: {state.message}</Text>
        )}
      </View>
    );
  }

  return (
    <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: "lift" }} />
        <Stack.Screen name="workout" options={{ title: "workout", headerBackTitle: "home" }} />
        <Stack.Screen name="exercises/index" options={{ title: "exercises" }} />
        <Stack.Screen name="exercises/[id]" options={{ title: "" }} />
        <Stack.Screen name="add-exercise" options={{ title: "add exercise", presentation: "modal" }} />
        <Stack.Screen name="history/index" options={{ title: "history" }} />
        <Stack.Screen name="history/[id]" options={{ title: "" }} />
        <Stack.Screen name="templates/index" options={{ title: "templates" }} />
        <Stack.Screen name="templates/[id]" options={{ title: "template" }} />
        <Stack.Screen name="custom-exercise/new" options={{ title: "new exercise" }} />
        <Stack.Screen name="custom-exercise/[id]" options={{ title: "edit exercise" }} />
        <Stack.Screen name="bodyweight" options={{ title: "bodyweight" }} />
        <Stack.Screen name="calculators" options={{ title: "calculators" }} />
        <Stack.Screen name="settings" options={{ title: "settings" }} />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
