import { Alert } from "react-native";
import { router } from "expo-router";
import { startWorkoutFromTemplate } from "../../db/templates";

/** start from a template and open the logger; an open workout is offered instead */
export function startTemplate(templateId: string): void {
  const result = startWorkoutFromTemplate(templateId);
  if (!result) {
    Alert.alert("template not found");
    return;
  }
  if (!result.started) {
    Alert.alert("workout in progress", `finish or discard "${result.workout.title}" first.`, [
      { text: "cancel", style: "cancel" },
      { text: "resume", onPress: () => router.push("/workout") },
    ]);
    return;
  }
  router.push("/workout");
}
