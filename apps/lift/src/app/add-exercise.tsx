import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ExercisePicker } from "../components/ExercisePicker";
import { useColors } from "../components/theme";
import { addExercise } from "../db/workouts";
import { flushPendingWrites } from "../lib/pending";

// picker mode of the exercise search, presented as a modal over the logger
export default function AddExercise() {
  const c = useColors();
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ExercisePicker
        autoFocus
        onSelect={(e) => {
          if (workoutId) {
            flushPendingWrites();
            addExercise(workoutId, e.id);
          }
          router.back();
        }}
      />
    </View>
  );
}
