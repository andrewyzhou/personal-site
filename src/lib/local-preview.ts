// a local design preview on real data: `DESIGN_PREVIEW=1 next dev` only.
// it opens the admin pages without a google sign-in, for looking at them
// during development. it never applies to a deployed build, and it only ever
// grants reads: every write still needs a real admin session.
export function isLocalPreview(): boolean {
  return process.env.DESIGN_PREVIEW === "1" && process.env.NODE_ENV === "development" && !process.env.VERCEL;
}

export const LOCAL_PREVIEW_EMAIL = "local preview (read only)";
