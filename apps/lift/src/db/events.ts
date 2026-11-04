// tiny change feed: repositories call notify() after each committed write and
// screens re-read. avoids expo-sqlite's change listener, which needs
// enableChangeListener and fires per row.

type Listener = () => void;

const listeners = new Set<Listener>();
let version = 0;

export function notify(): void {
  version++;
  for (const l of [...listeners]) l();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVersion(): number {
  return version;
}
