import type { Metadata } from "next";
import "@/design-system/ds.css";
import { AppShell, Button, Card, Container, Stack, Text, getBrand } from "@/design-system";
import { auth, signIn, signOut, isGoogleAuthConfigured } from "@/lib/auth";
import { LOCAL_PREVIEW_EMAIL, isLocalPreview } from "@/lib/local-preview";
import NewEntryMenu from "@/components/admin/NewEntryMenu";
import "./admin.css";

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

const brand = getBrand("admin")!;

// the admin's own frame: a left sidebar on wide screens, a menu bar on
// phones, in the admin design (src/design-system/brands, docs at /design/admin).
// it never follows the public site's theme.
const MODEL = {
  mark: { label: "admin", href: "/admin", logo: "/images/az-logo.svg" },
  nav: [
    { label: "dashboard", href: "/admin", exact: true },
    { label: "content", href: "/admin/content", match: ["/admin/essays", "/admin/leetcode"] },
    { label: "activities", href: "/admin/calendar", match: ["/admin/activities", "/admin/upload"] },
    { label: "listening", href: "/admin/listening" },
    { label: "privacy", href: "/admin/privacy" },
  ],
  footer: "",
  labels: { menu: "menu", theme: "switch to {theme} mode" },
};

// the layout is the auth gate for every /admin page. defense in depth: every
// mutation route still verifies the session/secret itself.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = isLocalPreview() ? { user: { email: LOCAL_PREVIEW_EMAIL, isAdmin: true } } : await auth();
  const user = session?.user as { email?: string | null; isAdmin?: boolean } | undefined;

  if (!user || !user.isAdmin) {
    return (
      <div className="ds adm-gate" {...{ "data-brand": brand.id, "data-accent": brand.accent, "data-chip": brand.components.chip, "data-link": brand.components.inlineLink, "data-stats": brand.components.stats }}>
        <Container width="prose">
          <Card title={!user ? "sign in to admin" : "not authorized"}>
            {!user ? (
              isGoogleAuthConfigured() ? (
                <form
                  action={async () => {
                    "use server";
                    await signIn("google", { redirectTo: "/admin" });
                  }}
                >
                  <Button type="submit" variant="primary">
                    sign in with google
                  </Button>
                </form>
              ) : (
                <Text tone="muted" size="sm">
                  google sign-in is not configured — set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
                </Text>
              )
            ) : (
              <Stack gap="4">
                <Text tone="muted" size="sm">{`signed in as ${user.email}`}</Text>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/admin" });
                  }}
                >
                  <Button type="submit">sign out</Button>
                </form>
              </Stack>
            )}
          </Card>
        </Container>
      </div>
    );
  }

  return (
    <AppShell
      model={MODEL}
      brand={brand}
      hideFooter
      className="adm"
      actions={
        <>
          <NewEntryMenu />
          {isLocalPreview() ? (
            <span className="adm-preview-tag">
              <Text size="xs" tone="subtle">
                {LOCAL_PREVIEW_EMAIL}
              </Text>
            </span>
          ) : (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/admin" });
              }}
            >
              <Button type="submit" variant="ghost" size="sm">
                sign out
              </Button>
            </form>
          )}
        </>
      }
    >
      <div className="adm-main">{children}</div>
    </AppShell>
  );
}
