import type { Metadata } from "next";
import { auth, signIn, signOut, isGoogleAuthConfigured } from "@/lib/auth";

export const metadata: Metadata = {
  title: "admin · andrew zhou",
  manifest: "/admin-manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "az admin",
    statusBarStyle: "black-translucent",
  },
};

// the layout is the auth gate for every /admin page. defense in depth: every
// mutation route still verifies the session/secret itself.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user as { email?: string | null; isAdmin?: boolean } | undefined;

  if (!user) {
    return (
      <AdminShell>
        <div className="card-bg rounded-lg" style={{ padding: "24px", textAlign: "center" }}>
          <h1 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: "1rem" }}>
            admin
          </h1>
          {isGoogleAuthConfigured() ? (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/admin" });
              }}
            >
              <button
                type="submit"
                className="font-sans text-off-white text-lg link-highlight rounded-lg"
                style={{ padding: "12px 20px", width: "100%" }}
              >
                sign in with google
              </button>
            </form>
          ) : (
            <p className="font-sans text-gray text-sm italic">
              google sign-in is not configured — set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
            </p>
          )}
        </div>
      </AdminShell>
    );
  }

  if (!user.isAdmin) {
    return (
      <AdminShell>
        <div className="card-bg rounded-lg" style={{ padding: "24px", textAlign: "center" }}>
          <h1 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: "0.5rem" }}>
            not authorized
          </h1>
          <p className="font-sans text-gray text-sm" style={{ marginBottom: "1rem" }}>
            signed in as {user.email}
          </p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/admin" });
            }}
          >
            <button type="submit" className="font-sans text-gray text-sm link-highlight">
              sign out
            </button>
          </form>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="flex items-center justify-between" style={{ marginBottom: "1.5rem" }}>
        <h1 className="font-sans font-bold text-off-white text-3xl">admin</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/admin" });
          }}
        >
          <button type="submit" className="font-sans text-gray text-sm link-highlight">
            sign out
          </button>
        </form>
      </div>
      {children}
    </AdminShell>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="site-container">
      <section className="py-16" style={{ maxWidth: "480px", marginLeft: "auto", marginRight: "auto" }}>
        {children}
      </section>
    </main>
  );
}
