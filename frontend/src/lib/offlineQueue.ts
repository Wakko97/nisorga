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

/**
 * Persists `queue` and notifies listeners. Returns whether the write
 * actually succeeded — on failure (private-mode Safari, quota exceeded) the
 * listeners are still notified, but with the queue as it truly exists in
 * storage (unchanged), not the write that failed, so the UI never claims an
 * item was queued when it wasn't.
 */
function writeQueue(queue: QueuedItem[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error("offlineQueue: failed to persist queue (storage unavailable or full):", err);
    listeners.forEach((l) => l(readQueue()));
    return false;
  }
  listeners.forEach((l) => l(queue));
  return true;
}

export function getQueue(): QueuedItem[] {
  return readQueue();
}

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Queues a quick-capture title for later sync (used when POST /items fails
 * due to being offline). Returns false if it could not actually be
 * persisted (storage unavailable/full) — callers must not tell the user
 * their item is safely queued in that case.
 */
export function enqueueItem(title: string): boolean {
  const queue = readQueue();
  queue.push({ localId: crypto.randomUUID(), title, queuedAt: new Date().toISOString() });
  return writeQueue(queue);
}

function removeByLocalId(localId: string): void {
  writeQueue(readQueue().filter((i) => i.localId !== localId));
}

// Guards against overlapping flushes (e.g. two "online" events firing in
// quick succession on a flaky mobile reconnect): concurrent callers all
// await the same in-flight run instead of each independently reading the
// queue and posting the same items twice.
let flushInFlight: Promise<number> | null = null;

export function flushQueue(): Promise<number> {
  if (!flushInFlight) {
    flushInFlight = runFlush().finally(() => {
      flushInFlight = null;
    });
  }
  return flushInFlight;
}

/**
 * Re-posts queued items one at a time, always re-reading the queue from
 * storage immediately before removing an item (rather than mutating a
 * local snapshot across the `await`) so an item enqueued concurrently by
 * another caller is never clobbered by a stale write-back.
 *
 * A network error (still offline) stops the flush entirely — those items
 * stay queued for the next attempt. Any other error (e.g. an expired auth
 * session, so the item can't currently be created) does not lose the item
 * or wedge the ones behind it: that item is skipped for this pass and
 * retried on the next flush, once per item per call to avoid spinning.
 */
async function runFlush(): Promise<number> {
  let synced = 0;
  const skippedThisPass = new Set<string>();

  while (true) {
    const queue = readQueue().filter((i) => !skippedThisPass.has(i.localId));
    if (queue.length === 0) break;
    const next = queue[0];

    try {
      await api.post("/items", { title: next.title });
    } catch (err) {
      if (isNetworkError(err)) break;
      skippedThisPass.add(next.localId);
      continue;
    }

    removeByLocalId(next.localId);
    synced += 1;
  }

  return synced;
}

/** True if the fetch failure looks like "no network" rather than a server-side rejection. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}
