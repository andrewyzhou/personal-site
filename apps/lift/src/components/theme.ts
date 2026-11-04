import { useColorScheme } from "react-native";

export interface Palette {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
  done: string;
  input: string;
}

const light: Palette = {
  bg: "#f6f6f4",
  card: "#ffffff",
  text: "#151515",
  muted: "#6b6b6b",
  border: "#e2e2de",
  accent: "#1f5eff",
  accentText: "#ffffff",
  danger: "#c8322b",
  done: "#d9f2df",
  input: "#efefec",
};

const dark: Palette = {
  bg: "#0d0d0e",
  card: "#18181a",
  text: "#f2f2f2",
  muted: "#9a9a9a",
  border: "#2a2a2d",
  accent: "#5b8cff",
  accentText: "#ffffff",
  danger: "#ff6b61",
  done: "#173a22",
  input: "#232326",
};

export function useColors(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
