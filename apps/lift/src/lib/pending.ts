// registry of debounced inputs that may hold an unwritten value. structural
// actions (add set, finish, ...) read from sqlite, so they flush these first;
// otherwise a weight typed <300ms before tapping "add set" would be missed.

type Flush = () => void;

const flushers = new Set<Flush>();

export function registerFlush(flush: Flush): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

export function flushPendingWrites(): void {
  for (const f of [...flushers]) f();
}
