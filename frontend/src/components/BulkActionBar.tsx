import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, bulkDeleteItems, bulkUpdateItems, BulkSkipped } from "../lib/api";
import { Item, User } from "../lib/types";

function skippedMessage(total: number, skipped: BulkSkipped[]): string {
  const ok = total - skipped.length;
  if (skipped.length === 0) return `${ok} von ${total} Items aktualisiert.`;
  return `${ok} von ${total} Items aktualisiert, ${skipped.length} übersprungen (kein Zugriff).`;
}

export default function BulkActionBar({
  selectedIds,
  users,
  onCleared,
  showConvert,
}: {
  selectedIds: Set<string>;
  users: User[] | undefined;
  onCleared: () => void;
  showConvert?: boolean;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ids = Array.from(selectedIds);
  if (ids.length === 0) return null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["items"] });

  async function runUpdate(patch: Parameters<typeof bulkUpdateItems>[1]) {
    setBusy(true);
    try {
      const res = await bulkUpdateItems<Item>(ids, patch);
      setMessage(skippedMessage(ids.length, res.skipped));
      invalidate();
      onCleared();
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    await runUpdate({ status: "DONE" });
  }

  async function handleAssign(userId: string) {
    await runUpdate({ assignedToId: userId || null });
  }

  async function handleConvert() {
    setBusy(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.post(`/items/${id}/convert`)));
      const failed = results.filter((r) => r.status === "rejected").length;
      setMessage(
        failed === 0
          ? `${ids.length} Items zu Aufgaben konvertiert.`
          : `${ids.length - failed} von ${ids.length} Items konvertiert, ${failed} fehlgeschlagen.`
      );
      invalidate();
      onCleared();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`${ids.length} Item(s) wirklich löschen?`)) return;
    setBusy(true);
    try {
      const res = await bulkDeleteItems(ids);
      const ok = res.deletedIds.length;
      setMessage(
        res.skipped.length === 0
          ? `${ok} Items gelöscht.`
          : `${ok} von ${ids.length} Items gelöscht, ${res.skipped.length} übersprungen (kein Zugriff).`
      );
      invalidate();
      onCleared();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-gray-900 text-white px-3 py-2 text-sm">
      <span className="font-medium">{ids.length} ausgewählt</span>

      <button
        disabled={busy}
        onClick={handleArchive}
        className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
      >
        Archivieren
      </button>

      {showConvert && (
        <button
          disabled={busy}
          onClick={handleConvert}
          className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
        >
          Zu Aufgabe konvertieren
        </button>
      )}

      <select
        disabled={busy}
        defaultValue="__placeholder__"
        onChange={(e) => {
          if (e.target.value !== "__placeholder__") handleAssign(e.target.value);
          e.target.value = "__placeholder__";
        }}
        className="px-2 py-1 rounded bg-white/10 border border-white/20 text-white disabled:opacity-50"
      >
        <option value="__placeholder__" disabled>
          Zuweisen an…
        </option>
        <option value="">Nicht zugewiesen</option>
        {users?.map((u) => (
          <option key={u.id} value={u.id} className="text-black">
            {u.name}
          </option>
        ))}
      </select>

      <button
        disabled={busy}
        onClick={handleDelete}
        className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50"
      >
        Löschen
      </button>

      <button
        disabled={busy}
        onClick={onCleared}
        className="px-2 py-1 rounded border border-white/30 hover:bg-white/10 disabled:opacity-50 ml-auto"
      >
        Auswahl aufheben
      </button>

      {message && <span className="w-full text-xs text-gray-300">{message}</span>}
    </div>
  );
}
