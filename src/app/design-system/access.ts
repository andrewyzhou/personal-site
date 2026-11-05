import { isAdminViewer } from "@/app/admin/require-admin";

// the design lab is for the owner: admins on the live site, anyone on a local
// dev server, and the design test harness (never in production)
export async function canViewDesignLab(): Promise<boolean> {
  if (process.env.NODE_ENV === "development") return true;
  if (process.env.DESIGN_FIXTURES === "1" && process.env.VERCEL_ENV !== "production") return true;
  return isAdminViewer();
}
