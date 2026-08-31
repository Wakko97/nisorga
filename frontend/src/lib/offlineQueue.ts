import { api } from "./api";

const STORAGE_KEY = "nisorga.offlineQueue.items";

export interface QueuedItem {
  localId: string;
  title: string;
  queuedAt: string;
}

type Listener = (queue: QueuedItem[]) => void;
const listeners = new Set<Listener>();

function readQueue(): QueuedItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage unavailable (private mode, quota) — queueing degrades to a no-op.
  }
  listeners.forEach((l) => l(queue));
}

export function getQueue(): QueuedItem[] {
  return readQueue();
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Queues a quick-capture title for later sync (used when POST /items fails due to being offline). */
export function enqueueItem(title: string): void {
  const queue = readQueue();
  queue.push({ localId: crypto.randomUUID(), title, queuedAt: new Date().toISOString() });
  writeQueue(queue);
}

/**
 * Flushes the offline queue by re-posting each item, in order, stopping at
 * the first failure (so a still-offline connection doesn't drop items —
 * they simply stay queued for the next flush). Returns how many synced.
 */
export async function flushQueue(): Promise<number> {
  const queue = readQueue();
  let synced = 0;
  while (queue.length > 0) {
    const next = queue[0];
    try {
      await api.post("/items", { title: next.title });
    } catch {
      break;
    }
    queue.shift();
    synced += 1;
    writeQueue(queue);
  }
  return synced;
}

/** True if the fetch failure looks like "no network" rather than a server-side rejection. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}
