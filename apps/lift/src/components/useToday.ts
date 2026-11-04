import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { dayKey, msUntilNextDay } from "../lib/calendar";

/**
 * a clock reading that moves when the day changes: at local midnight, and
 * when the app comes back to the foreground (timers don't run while
 * suspended, and the zone may have changed meanwhile).
 */
export function useToday(): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    // only re-render when the local day actually differs
    const refresh = () => setNow((prev) => (dayKey(prev) === dayKey(Date.now()) ? prev : Date.now()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refresh();
        arm();
      }, msUntilNextDay(Date.now()));
    };
    arm();
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      refresh();
      arm();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return now;
}
