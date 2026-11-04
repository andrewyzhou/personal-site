import { View } from "react-native";
import { router } from "expo-router";
import { ExercisePicker } from "../../components/ExercisePicker";
import { useColors } from "../../components/theme";
import { isCustomId } from "../../lib/custom";

// tap opens the detail; long-press on a custom exercise opens its editor
export default function Exercises() {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ExercisePicker
        showFilters
        onCreate={() => router.push("/custom-exercise/new")}
        onSelect={(e) => router.push({ pathname: "/exercises/[id]", params: { id: e.id } })}
        onLongPress={(e) => {
          if (isCustomId(e.id)) router.push({ pathname: "/custom-exercise/[id]", params: { id: e.id } });
        }}
      />
    </View>
  );
}
