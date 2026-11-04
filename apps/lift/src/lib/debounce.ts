// coalesces keystrokes into one write. flush() is called on blur/unmount so
// the last value always reaches sqlite even if the timer never fires.

export interface DebouncedCommit<T> {
  set(value: T): void;
  flush(): void;
  cancel(): void;
  readonly pending: boolean;
}

export function createDebouncedCommit<T>(commit: (value: T) => void, delayMs = 300): DebouncedCommit<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasValue = false;
  let latest: T;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!hasValue) return;
    hasValue = false;
    commit(latest);
  };

  return {
    set(value: T) {
      latest = value;
      hasValue = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      hasValue = false;
    },
    get pending() {
      return hasValue;
    },
  };
}
