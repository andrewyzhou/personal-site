// minimal structured logger for server-side code. one json line per event so
// vercel's log view (and any future drain) can filter by source and level.
type Level = "info" | "warn" | "error";

function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function emit(level: Level, source: string, message: string, err?: unknown) {
  const entry: Record<string, string> = { level, source, message };
  if (err !== undefined) entry.error = serializeError(err);
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (source: string, message: string) => emit("info", source, message),
  warn: (source: string, message: string, err?: unknown) => emit("warn", source, message, err),
  error: (source: string, message: string, err?: unknown) => emit("error", source, message, err),
};
