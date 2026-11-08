// whether the garmin personal api source is on (its key is set). kept apart
// from garmin.ts so modules that only need the flag don't load the client.
export function isGarminConfigured(): boolean {
  return Boolean(process.env.GARMIN_PERSONAL_API_KEY?.trim());
}
