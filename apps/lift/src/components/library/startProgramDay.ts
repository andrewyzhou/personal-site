import { Alert } from "react-native";
import { router } from "expo-router";
import { startNextProgramDay } from "../../db/programs";

/** start the program's next day and open the logger; an open workout is offered instead */
export function startProgramDay(programId: string): void {
  const result = startNextProgramDay(programId);
  switch (result.kind) {
    case "started":
      router.push("/workout");
      return;
    case "in_progress":
      Alert.alert("workout in progress", `finish or discard "${result.workout.title}" first.`, [
        { text: "cancel", style: "cancel" },
        { text: "resume", onPress: () => router.push("/workout") },
      ]);
      return;
    case "done":
      Alert.alert("program finished", "restart it from the programs screen to go again.");
      return;
    case "missing_template":
      Alert.alert("template not found", "the next day's template was deleted. pick another one in the program.");
      return;
    case "not_found":
      Alert.alert("program not found");
  }
}
