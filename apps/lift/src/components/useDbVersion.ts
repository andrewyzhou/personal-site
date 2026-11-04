import { useSyncExternalStore } from "react";
import { getVersion, subscribe } from "../db/events";

/** bumps after every committed write; use as a dependency to re-read sqlite */
export function useDbVersion(): number {
  return useSyncExternalStore(subscribe, getVersion);
}
