// at most one run at a time: a call while one is in flight gets that same
// promise. foreground, interval and manual syncs all go through this, so two
// of them can't read and send the same outbox rows.

export interface SingleFlight<T, A> {
  /** `arg` is only used when this call starts a new run */
  run(arg: A): Promise<T>;
  busy(): boolean;
}

export function singleFlight<T, A = void>(fn: (arg: A) => Promise<T>, onChange?: () => void): SingleFlight<T, A> {
  let inflight: Promise<T> | null = null;
  return {
    run(arg) {
      if (inflight) return inflight;
      // set before fn's first await, so a call in the same tick joins
      const p = Promise.resolve()
        .then(() => fn(arg))
        .finally(() => {
          inflight = null;
          onChange?.();
        });
      inflight = p;
      onChange?.();
      return p;
    },
    busy: () => inflight !== null,
  };
}
