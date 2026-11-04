import { useColorScheme } from "react-native";
import { dark, light, type Palette } from "../lib/palette";

export { dark, light, type Palette };

export function useColors(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
