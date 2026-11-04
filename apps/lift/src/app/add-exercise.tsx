import { View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ExercisePicker } from "../components/ExercisePicker";
import { useColors } from "../components/theme";
import { addExercise, replaceExercise } from "../db/workouts";
import { flushPendingWrites } from "../lib/pending";

// picker mode of the exercise search, presented as a modal over the logger.
// with `replace` (a workout exercise id) it swaps that exercise, keeping its sets.
export default function AddExercise() {
  const c = useColors();
  const { workoutId, replace, current } = useLocalSearchParams<{ workoutId: string; replace?: string; current?: string }>();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: replace ? "replace exercise" : "add exercise" }} />
      <ExercisePicker
        autoFocus
        excludeIds={replace && current ? [current] : undefined}
        onSelect={(e) => {
          flushPendingWrites();
          if (replace) replaceExercise(replace, e.id);
          else if (workoutId) addExercise(workoutId, e.id);
          router.back();
        }}
      />
    </View>
  );
}
