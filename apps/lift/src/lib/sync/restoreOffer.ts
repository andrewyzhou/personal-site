// whether home should offer "restore from server" instead of a blank slate.
// the keychain outlives a reinstall on ios, so a saved token with an empty db
// almost always means a reinstall (or a new phone restored from a backup).

export interface RestoreOfferState {
  hasToken: boolean;
  /** rows in every synced table: workouts, templates, folders, customs, bodyweights, ... */
  localRows: number;
  /** outbox rows not yet synced, or refused */
  pending: number;
  restoredAt: number | null;
  dismissed: boolean;
}

export function shouldOfferRestore(s: RestoreOfferState): boolean {
  // anything local means the user started fresh on purpose; replacing it
  // stays behind the confirm in settings
  return s.hasToken && s.localRows === 0 && s.pending === 0 && s.restoredAt === null && !s.dismissed;
}
