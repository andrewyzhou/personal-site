import { getSessionUser } from "@/lib/auth";

// per-page auth for admin server components that load data. the layout's gate
// isn't enough on its own: a soft navigation (or a hand-made rsc request)
// renders only the page segment, without re-running the layout, and next may
// render a page alongside its layout. pages bail out with nothing (no throw,
// so the layout's sign-in screen still renders on a full load).
export async function isAdminViewer(): Promise<boolean> {
  try {
    const user = await getSessionUser();
    return user?.isAdmin === true;
  } catch {
    return false;
  }
}
