import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// google sign-in for /admin (and reused for public users in ws5). any google
// account may sign in — admin rights come only from the ADMIN_EMAILS allowlist,
// stamped into the jwt/session here. jwt strategy, no database adapter.

const adminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails.includes(email.toLowerCase());
}

// provider list is empty until google oauth creds exist so the app boots
// (sign-in just fails visibly) instead of crashing at import time
const providers = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token }) {
      token.isAdmin = isAdminEmail(token.email);
      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        user: { ...session.user, isAdmin: token.isAdmin === true },
      };
    },
  },
});

export function isGoogleAuthConfigured(): boolean {
  return providers.length > 0;
}

// convenience for server components / route handlers
export async function getSessionUser(): Promise<{ email: string | null; isAdmin: boolean } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const user = session.user as { email?: string | null; isAdmin?: boolean };
  return { email: user.email ?? null, isAdmin: user.isAdmin === true };
}
