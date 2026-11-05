import { describe, it, expect, vi, beforeEach } from "vitest";

// admin server pages rendered on their own (soft navigation / rsc request,
// no layout): a non-admin gets nothing and no data is loaded
const { user, dbCalls, r2Calls } = vi.hoisted(() => ({
  user: { value: null as { email: string | null; isAdmin: boolean } | null | Error },
  dbCalls: { n: 0 },
  r2Calls: { n: 0 },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: async () => {
    if (user.value instanceof Error) throw user.value;
    return user.value;
  },
}));
vi.mock("@/lib/db", () => ({
  activities: {},
  activityPhotos: {},
  activitySources: {},
  getDb: () => {
    dbCalls.n++;
    throw new Error("db touched");
  },
}));
vi.mock("@/lib/r2", () => ({
  r2Usage: async () => {
    r2Calls.n++;
    return { totalBytes: 0, count: 0 };
  },
}));
vi.mock("@/components/admin/EditActivity", () => ({ default: () => null }));
vi.mock("@/components/admin/PrivacyAdmin", () => ({ default: () => null }));
vi.mock("@/components/RouteThumb", () => ({ default: () => null }));
vi.mock("@/components/admin/ListeningAdmin", () => ({ default: () => null }));
vi.mock("@/lib/listening/admin-data", () => ({
  loadListeningOverview: async () => {
    dbCalls.n++;
    throw new Error("db touched");
  },
}));

import AdminDashboard from "@/app/admin/page";
import AdminEditActivityPage from "@/app/admin/activities/[id]/page";
import AdminPrivacyPage from "@/app/admin/privacy/page";
import AdminListeningPage from "@/app/admin/listening/page";
import { isAdminViewer } from "@/app/admin/require-admin";

beforeEach(() => {
  dbCalls.n = 0;
  r2Calls.n = 0;
});

describe("admin pages without the layout", () => {
  for (const [label, u] of [
    ["signed out", null],
    ["signed in, not admin", { email: "x@example.com", isAdmin: false }],
    ["auth error", new Error("bad cookie")],
  ] as const) {
    it(`${label}: render nothing, load nothing`, async () => {
      user.value = u;
      expect(await AdminDashboard()).toBeNull();
      expect(await AdminEditActivityPage({ params: Promise.resolve({ id: "12" }) })).toBeNull();
      expect(await AdminPrivacyPage()).toBeNull();
      expect(await AdminListeningPage()).toBeNull();
      expect(dbCalls.n).toBe(0);
      expect(r2Calls.n).toBe(0);
    });
  }

  it("an admin gets through to the data", async () => {
    user.value = { email: "a@example.com", isAdmin: true };
    expect(await isAdminViewer()).toBe(true);
    await expect(AdminEditActivityPage({ params: Promise.resolve({ id: "12" }) })).rejects.toThrow("db touched");
    expect(dbCalls.n).toBe(1);
    expect(await AdminPrivacyPage()).not.toBeNull();
    // the listening page loads its data (and renders an error message when that fails)
    expect(await AdminListeningPage()).not.toBeNull();
    expect(dbCalls.n).toBe(2);
  });
});
