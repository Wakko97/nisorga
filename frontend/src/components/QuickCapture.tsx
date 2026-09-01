import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import ScanCapture from "./ScanCapture";
import { enqueueItem, flushQueue, getQueue, isNetworkError, subscribeQueue } from "../lib/offlineQueue";

export default function QuickCapture() {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queuedCount, setQueuedCount] = useState(() => getQueue().length);
  const [syncing, setSyncing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  async function sync() {
    if (getQueue().length === 0) return;
    setSyncing(true);
    const synced = await flushQueue();
    setSyncing(false);
    if (synced > 0) queryClient.invalidateQueries({ queryKey: ["items"] });
  }

  useEffect(() => {
    const unsubscribe = subscribeQueue((queue) => setQueuedCount(queue.length));
    sync(); // attempt a flush on mount, in case items were queued in a previous session
    window.addEventListener("online", sync);
    return () => {
      unsubscribe();
      window.removeEventListener("online", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The command palette's "Neue Idee erfassen" navigates here with
  // ?focus=capture so the input is focused right away, same as pressing "n".
  useEffect(() => {
    if (searchParams.get("focus") === "capture") {
      inputRef.current?.focus();
      searchParams.delete("focus");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const { isSupported, isListening, transcript, start, stop } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) setTitle(transcript);
  }, [transcript]);

  const createItem = useMutation({
    mutationFn: (title: string) => api.post("/items", { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setTitle("");
    },
    onError: (err, title) => {
      // Offline: queue it locally rather than losing the captured title —
      // it's synced automatically once the connection (or the app) comes
      // back, see lib/offlineQueue.ts.
      if (isNetworkError(err)) {
        if (enqueueItem(title)) {
          setQueueError(null);
          setTitle("");
        } else {
          // Couldn't persist (storage full/unavailable) — keep the typed
          // title in the input rather than claiming it's safely queued.
          setQueueError("Konnte nicht offline gespeichert werden (Speicher voll?). Bitte Titel notieren.");
        }
      }
    },
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = ["INPUT", "TEXTAREA"].includes(target.tagName);
      if (e.key === "n" && !isTyping) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    createItem.mutate(title.trim());
  }

  return (
    <div className="mb-6">
      <div className="flex gap-2">
        {/* Only the title input lives in the <form>: browsers only submit on
            Enter implicitly when there's exactly one text field in the form,
            so the file input inside ScanCapture must stay outside it. */}
        <form onSubmit={handleSubmit} className="flex-1 min-w-0">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Neue Idee oder Aufgabe erfassen… (Taste „n“ fokussiert dieses Feld, Enter speichert)"
            className="input py-3 min-h-[48px] text-base sm:text-lg shadow-sm"
          />
        </form>
        <button
          type="button"
          onClick={() => (isListening ? stop() : start())}
          disabled={!isSupported}
          title={isSupported ? "Spracheingabe" : "Spracheingabe nicht unterstützt"}
          className={`shrink-0 w-12 h-12 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border shadow-sm text-lg ${
            isListening ? "bg-red-600 text-white border-red-600" : "bg-white hover:bg-gray-100"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          🎤
        </button>
        <ScanCapture />
      </div>
      {queueError && <p className="mt-2 text-xs text-red-600">{queueError}</p>}
      {queuedCount > 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs text-amber-700">
          <span className="badge-warn">
            {syncing ? "Synchronisiere…" : `${queuedCount} offline erfasst, wartet auf Sync`}
          </span>
          {!syncing && (
            <button type="button" onClick={sync} className="underline hover:no-underline">
              Jetzt synchronisieren
            </button>
          )}
        </div>
      )}
    </div>
  );
}
