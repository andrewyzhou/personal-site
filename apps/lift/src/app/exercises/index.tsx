import { View } from "react-native";
import { router } from "expo-router";
import { ExercisePicker } from "../../components/ExercisePicker";
import { useColors } from "../../components/theme";

export default function Exercises() {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ExercisePicker
        onSelect={(e) => router.push({ pathname: "/exercises/[id]", params: { id: e.id } })}
      />
    </View>
  );
}
