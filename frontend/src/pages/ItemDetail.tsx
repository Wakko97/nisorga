import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch, ApiError, fetchAttachmentUrl } from "../lib/api";
import { Item, User, Comment } from "../lib/types";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "../lib/datetime";

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);

  const { data: item, isLoading, isError } = useQuery<Item>({
    queryKey: ["items", id],
    queryFn: async () => {
      // There is no single-item GET endpoint; the item list is filtered client-side.
      const all = await api.get<Item[]>("/items");
      const found = all.find((i) => i.id === id);
      if (!found) throw new ApiError(404, "Not found");
      return found;
    },
    enabled: !!id,
    retry: false,
  });

  useEffect(() => {
    if (item) {
      setTitleDraft(item.title);
      setDescriptionDraft(item.description ?? "");
    }
  }, [item?.id]);

  // The attachment route is cookie-authenticated; a plain <img src> may not
  // reliably send credentials cross-port/-origin, so the image bytes are
  // fetched with credentials and shown via a local blob: URL instead.
  useEffect(() => {
    let objectUrl: string | null = null;
    if (item?.attachmentPath && id) {
      fetchAttachmentUrl(id)
        .then((url) => {
          objectUrl = url;
          setAttachmentUrl(url);
        })
        .catch(() => setAttachmentUrl(null));
    } else {
      setAttachmentUrl(null);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item?.attachmentPath, id]);
  const { data: users } = useQuery<User[]>({ queryKey: ["users"], queryFn: () => api.get("/users") });
  const { data: comments } = useQuery<Comment[]>({
    queryKey: ["comments", id],
    queryFn: () => api.get(`/items/${id}/comments`),
    enabled: !!id,
  });
  const { data: googleStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["google-status"],
    queryFn: () => api.get("/integrations/google/status"),
  });

  const updateItem = useMutation({
    mutationFn: (data: Partial<Item>) => api.patch(`/items/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  const convertItem = useMutation({
    mutationFn: () => api.post(`/items/${id}/convert`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  const deleteItem = useMutation({
    mutationFn: () => api.delete(`/items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      navigate("/inbox");
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: () => apiFetch(`/items/${id}/attachment`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => api.post(`/items/${id}/comments`, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", id] });
      setCommentBody("");
    },
  });

  const syncGoogle = useMutation({
    mutationFn: () => api.post(`/integrations/google/sync/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setSyncMessage("Mit Google Kalender synchronisiert.");
    },
    onError: (err) => setSyncMessage(err instanceof ApiError ? err.message : "Sync fehlgeschlagen"),
  });

  if (isLoading) return <p className="text-gray-500">Lädt…</p>;

  if (isError || !item) {
    return (
      <div className="max-w-2xl bg-white border rounded-lg p-6">
        <p className="text-gray-700 mb-3">
          Dieses Item existiert nicht oder du hast keinen Zugriff darauf.
        </p>
        <Link to="/inbox" className="text-sm underline text-gray-600">
          Zurück zur Inbox
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl bg-white border rounded-lg p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (titleDraft !== item.title) updateItem.mutate({ title: titleDraft });
          }}
          className="text-xl font-semibold border-b border-transparent focus:border-gray-300 focus:outline-none flex-1 min-w-0 py-1"
        />
        <button
          onClick={() => deleteItem.mutate()}
          className="text-sm text-red-600 border border-red-200 rounded px-3 py-2 min-h-[44px] hover:bg-red-50 shrink-0"
        >
          Löschen
        </button>
      </div>

      <textarea
        value={descriptionDraft}
        onChange={(e) => setDescriptionDraft(e.target.value)}
        onBlur={() => {
          if (descriptionDraft !== (item.description ?? "")) updateItem.mutate({ description: descriptionDraft });
        }}
        placeholder="Beschreibung…"
        className="w-full border rounded px-3 py-2 mb-4 text-sm"
        rows={4}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <label className="block mb-1 text-gray-600">Typ</label>
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 rounded bg-gray-100">{item.type === "IDEA" ? "Idee" : "Aufgabe"}</span>
            {item.type === "IDEA" && (
              <button
                onClick={() => convertItem.mutate()}
                className="text-xs underline text-gray-600"
              >
                zu Aufgabe konvertieren
              </button>
            )}
          </div>
        </div>
        <div>
          <label htmlFor="item-status" className="block mb-1 text-gray-600">Status</label>
          <select
            id="item-status"
            value={item.status}
            onChange={(e) => updateItem.mutate({ status: e.target.value as Item["status"] })}
            className="border rounded px-2 py-2 min-h-[44px] w-full"
          >
            <option value="INBOX">Inbox</option>
            <option value="TODO">To-do</option>
            <option value="IN_PROGRESS">In Arbeit</option>
            <option value="WAITING">Wartet auf Rückmeldung</option>
            <option value="DONE">Erledigt</option>
          </select>
          {item.status === "WAITING" && item.waitingSince && (
            <p className="text-xs text-gray-500 mt-1">
              Wartet seit {new Date(item.waitingSince).toLocaleDateString()}
            </p>
          )}
        </div>
        <div>
          <label className="block mb-1 text-gray-600">Zugewiesen an</label>
          <select
            value={item.assignedToId ?? ""}
            onChange={(e) => updateItem.mutate({ assignedToId: e.target.value || null })}
            className="border rounded px-2 py-2 min-h-[44px] w-full"
          >
            <option value="">Nicht zugewiesen</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block mb-1 text-gray-600">Fällig am</label>
          <input
            type="datetime-local"
            value={item.dueDate ? toDatetimeLocalValue(item.dueDate) : ""}
            onChange={(e) =>
              updateItem.mutate({ dueDate: e.target.value ? fromDatetimeLocalValue(e.target.value) : null })
            }
            className="border rounded px-2 py-2 min-h-[44px] w-full"
          />
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.important}
            onChange={(e) => updateItem.mutate({ important: e.target.checked })}
          />
          Wichtig
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.urgent}
            onChange={(e) => updateItem.mutate({ urgent: e.target.checked })}
          />
          Dringend
        </label>
      </div>

      {googleStatus?.connected && item.dueDate && (
        <div className="mb-4">
          <button
            onClick={() => syncGoogle.mutate()}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100"
          >
            {item.googleEventId ? "Google-Kalender-Event aktualisieren" : "Zu Google Kalender hinzufügen"}
          </button>
          {syncMessage && <p className="text-xs text-gray-500 mt-1">{syncMessage}</p>}
        </div>
      )}

      {item.attachmentPath && (
        <div className="mb-4">
          <label className="block mb-1 text-sm text-gray-600">Foto</label>
          {attachmentUrl ? (
            <img src={attachmentUrl} alt="Angehängtes Foto" className="max-w-full max-h-96 rounded border" />
          ) : (
            <p className="text-sm text-gray-500">Foto wird geladen…</p>
          )}
          <button
            type="button"
            onClick={() => deleteAttachment.mutate()}
            className="mt-2 text-sm text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
          >
            Anhang löschen
          </button>
        </div>
      )}

      <hr className="my-4" />
      <h2 className="font-semibold mb-2">Kommentare</h2>
      <ul className="space-y-2 mb-3">
        {comments?.map((c) => (
          <li key={c.id} className="text-sm bg-gray-50 border rounded p-2">
            <span className="font-medium">{c.author?.name}: </span>
            {c.body}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (commentBody.trim()) addComment.mutate(commentBody.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder="Kommentar hinzufügen…"
          className="flex-1 border rounded px-3 py-2 min-h-[44px] text-sm"
        />
        <button type="submit" className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white">
          Senden
        </button>
      </form>
    </div>
  );
}
