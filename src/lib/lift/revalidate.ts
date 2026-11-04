import { revalidateTag } from "next/cache";

// own module so routes can drop the lift cache without importing the loaders

export const LIFT_PUBLIC_TAG = "lift-public";

/** drop the cached lift-only index after a write so a fresh link works right away; no-op outside next */
export function revalidateLiftPublic(): void {
  try {
    revalidateTag(LIFT_PUBLIC_TAG, { expire: 0 });
  } catch {
    // tests and scripts have no cache to drop
  }
}
