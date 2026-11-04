import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type { WeightUnit } from "lift-core";
import { getUnit } from "../db/history";
import { countLocalWorkouts, getRestoredAt, restoreFromServer } from "../db/restore";
import { setDefaultUnit } from "../db/settings";
import {
  DEFAULT_SERVER_URL,
  countRejected,
  countUnsynced,
  getDeviceId,
  getLastSync,
  getServerUrl,
  getToken,
  isSyncing,
  setServerUrl,
  setToken,
  subscribeSyncStatus,
  syncNow,
} from "../db/sync";
import { Button } from "../components/Button";
import { formatDay } from "../components/charts/units";
import { useColors } from "../components/theme";
import { useDbVersion } from "../components/useDbVersion";

function timeOf(ms: number): string {
  const d = new Date(ms);
  return `${formatDay(ms)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function Settings() {
  const c = useColors();
  const version = useDbVersion();
  const syncing = useSyncExternalStore(subscribeSyncStatus, isSyncing);
  const [url, setUrl] = useState(() => getServerUrl());
  const [tokenSaved, setTokenSaved] = useState<boolean | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [unit, setUnitState] = useState<WeightUnit>(() => getUnit());
  const [restoring, setRestoring] = useState(false);
  const [tick, setTick] = useState(0);

  const deviceId = useMemo(() => getDeviceId(), []);
  const last = useMemo(() => getLastSync(), [syncing, tick]);
  const unsynced = useMemo(() => countUnsynced(), [version, syncing, tick]);
  const rejected = useMemo(() => countRejected(), [version, syncing, tick]);
  const restoredAt = useMemo(() => getRestoredAt(), [version, tick]);

  useEffect(() => {
    getToken().then(
      (t) => setTokenSaved(Boolean(t)),
      () => setTokenSaved(false)
    );
  }, []);

  const saveToken = async () => {
    if (!tokenDraft.trim()) return;
    await setToken(tokenDraft);
    setTokenDraft("");
    setTokenSaved(true);
  };

  const clearToken = async () => {
    await setToken("");
    setTokenSaved(false);
  };

  const changeUnit = (u: WeightUnit) => {
    setDefaultUnit(u);
    setUnitState(u);
  };

  const doRestore = async (replace: boolean, allowRejected = false) => {
    setRestoring(true);
    try {
      const r = await restoreFromServer({ replace, allowRejected });
      Alert.alert("restored", `${r.workouts} workouts, ${r.sets} sets${r.dropped ? `, ${r.dropped} orphans skipped` : ""}`);
    } catch (e) {
      Alert.alert("restore failed", e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
      setTick((t) => t + 1);
    }
  };

  const confirmRestore = (allowRejected = false) => {
    const pending = countUnsynced();
    if (pending > 0) {
      Alert.alert("sync first", `${pending} unsynced ${pending === 1 ? "change" : "changes"} would be lost. sync, then restore.`);
      return;
    }
    const refused = countRejected();
    if (refused > 0 && !allowRejected) {
      // these never reached the server, so the restore can't bring them back
      Alert.alert(
        "changes would be lost",
        `${refused} ${refused === 1 ? "change was" : "changes were"} refused by the server and only exist on this phone. try sync now first; restoring replaces them with the server copy.`,
        [
          { text: "cancel", style: "cancel" },
          { text: "restore anyway", style: "destructive", onPress: () => confirmRestore(true) },
        ]
      );
      return;
    }
    if (countLocalWorkouts() === 0) {
      Alert.alert("restore from server?", "downloads everything from the server into this phone.", [
        { text: "cancel", style: "cancel" },
        { text: "restore", onPress: () => void doRestore(false, allowRejected) },
      ]);
      return;
    }
    Alert.alert("replace local data?", "this phone already has workouts. they will be replaced by the server copy.", [
      { text: "cancel", style: "cancel" },
      { text: "replace local data", style: "destructive", onPress: () => void doRestore(true, allowRejected) },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "settings" }} />

      <Text style={[styles.section, { color: c.text }]}>units</Text>
      <View style={styles.toggle}>
        {(["lb", "kg"] as const).map((u) => (
          <Pressable
            key={u}
            onPress={() => changeUnit(u)}
            style={[styles.toggleItem, { backgroundColor: u === unit ? c.accent : c.input }]}
          >
            <Text style={{ color: u === unit ? c.accentText : c.text, fontWeight: "600" }}>{u}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.section, { color: c.text }]}>sync</Text>
      <Text style={[styles.label, { color: c.muted }]}>server url</Text>
      <TextInput
        value={url}
        onChangeText={setUrl}
        onEndEditing={() => {
          const v = url.trim() || DEFAULT_SERVER_URL;
          setUrl(v);
          setServerUrl(v);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { backgroundColor: c.input, color: c.text }]}
      />

      <Text style={[styles.label, { color: c.muted }]}>
        app token {tokenSaved === null ? "" : tokenSaved ? "· saved" : "· not set"}
      </Text>
      <TextInput
        value={tokenDraft}
        onChangeText={setTokenDraft}
        onSubmitEditing={() => void saveToken()}
        placeholder={tokenSaved ? "replace token" : "paste token"}
        placeholderTextColor={c.muted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { backgroundColor: c.input, color: c.text }]}
      />
      <View style={styles.rowButtons}>
        <Button label="save token" variant="plain" onPress={() => void saveToken()} style={styles.flex} />
        {tokenSaved ? (
          <Button label="clear" variant="danger" onPress={() => void clearToken()} style={styles.flex} />
        ) : null}
      </View>

      <Text style={[styles.label, { color: c.muted }]}>device id</Text>
      <Text style={[styles.mono, { color: c.text }]} selectable>
        {deviceId}
      </Text>

      <Text style={[styles.label, { color: c.muted }]}>last sync</Text>
      <Text style={{ color: last && !last.ok ? c.danger : c.text }}>
        {last ? `${timeOf(last.at)} · ${last.message}` : "never"}
      </Text>
      <Text style={{ color: c.muted }}>{unsynced} unsynced changes</Text>
      {rejected ? <Text style={{ color: c.danger }}>{rejected} refused by the server</Text> : null}
      {restoredAt ? <Text style={{ color: c.muted }}>restored {timeOf(restoredAt)}</Text> : null}

      <Button
        label={syncing ? "syncing…" : "sync now"}
        onPress={() => {
          if (!syncing) void syncNow().finally(() => setTick((t) => t + 1));
        }}
        style={styles.gap}
      />
      <Button
        label={restoring ? "restoring…" : "restore from server"}
        variant="plain"
        onPress={() => {
          if (!restoring) confirmRestore();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48, gap: 6 },
  section: { fontSize: 17, fontWeight: "600", marginTop: 16 },
  label: { fontSize: 13, marginTop: 10 },
  input: { fontSize: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  toggle: { flexDirection: "row", gap: 8 },
  toggleItem: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8 },
  rowButtons: { flexDirection: "row", gap: 8, marginTop: 6 },
  flex: { flex: 1 },
  mono: { fontFamily: "Courier", fontSize: 13 },
  gap: { marginTop: 16 },
});
