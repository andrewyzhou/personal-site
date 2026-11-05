import { V1_PATHS } from "./routes";

// request every route once before the suite so no test pays for a cold render
// (the dynamically rendered 404 was occasionally slow enough to flake)
export default async function warm(): Promise<void> {
  const base = `http://127.0.0.1:${process.env.DESIGN_PORT ?? 3100}`;
  for (const p of V1_PATHS) {
    await fetch(base + p).catch(() => undefined);
  }
}
