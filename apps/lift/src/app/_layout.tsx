import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View, useColorScheme } from "react-native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { sqlite } from "../db/client";
import { migrate } from "../db/migrate";
import { useColors } from "../components/theme";
import { flushOnAppState } from "../lib/pending";

// migrations run once per js runtime, before any screen touches the db
let ready: Promise<void> | null = null;

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = useColors();
  const [state, setState] = useState<"loading" | "ready" | Error>("loading");

  useEffect(() => {
    ready ??= migrate(sqlite);
    ready.then(
      () => setState("ready"),
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
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
