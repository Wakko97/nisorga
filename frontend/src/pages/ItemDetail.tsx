import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch, ApiError, fetchAttachmentUrl } from "../lib/api";
import { Item, User, Comment, Tag } from "../lib/types";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "../lib/datetime";
import TagBadge from "../components/TagBadge";

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");

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
  const { data: tags } = useQuery<Tag[]>({ queryKey: ["tags"], queryFn: () => api.get("/tags") });
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

  const addTag = useMutation({
    mutationFn: (tagId: string) => api.post(`/items/${id}/tags`, { tagId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
  const removeTag = useMutation({
    mutationFn: (tagId: string) => api.delete(`/items/${id}/tags/${tagId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
  const createTag = useMutation({
    mutationFn: (name: string) => api.post<Tag>("/tags", { name }),
    onSuccess: (tag) => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      setNewTagName("");
      addTag.mutate(tag.id);
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
      <div className="max-w-2xl panel p-6">
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
    <div className="max-w-2xl panel p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (titleDraft !== item.title) updateItem.mutate({ title: titleDraft });
          }}
          className="text-xl font-bold tracking-tight border-b border-transparent focus:border-brand-300 focus:outline-none flex-1 min-w-0 py-1"
        />
        <button
          onClick={() => deleteItem.mutate()}
          className="btn bg-white text-red-600 border border-red-200 hover:bg-red-50 shrink-0"
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
        className="input mb-4"
        rows={4}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <label className="block mb-1 text-gray-600">Typ</label>
          <div className="flex items-center gap-2">
            <span className="badge-neutral">{item.type === "IDEA" ? "Idee" : "Aufgabe"}</span>
            {item.type === "IDEA" && (
              <button
                onClick={() => convertItem.mutate()}
                className="text-xs text-brand-700 hover:underline"
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
            className="select"
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
            className="select"
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
            className="input"
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

      <div className="mb-4">
        <label className="block mb-1.5 text-sm text-gray-600">Tags</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {item.tags?.map(({ tag }) => (
            <TagBadge key={tag.id} tag={tag} onRemove={() => removeTag.mutate(tag.id)} />
          ))}
          {item.tags?.length === 0 && <span className="text-xs text-gray-400">Keine Tags</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags
            ?.filter((t) => !item.tags?.some(({ tag }) => tag.id === t.id))
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => addTag.mutate(t.id)}
                className="badge-neutral hover:bg-gray-200"
              >
                + {t.name}
              </button>
            ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newTagName.trim()) createTag.mutate(newTagName.trim());
            }}
            className="flex items-center gap-1"
          >
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Neuer Tag…"
              className="input text-xs px-2 py-1 min-h-0 w-28"
            />
          </form>
        </div>
      </div>

      {googleStatus?.connected && item.dueDate && (
        <div className="mb-4">
          <button
            onClick={() => syncGoogle.mutate()}
            className="btn-secondary text-sm px-3 py-1.5 min-h-0"
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
            <img src={attachmentUrl} alt="Angehängtes Foto" className="max-w-full max-h-96 rounded-lg border border-gray-200" />
          ) : (
            <p className="text-sm text-gray-500">Foto wird geladen…</p>
          )}
          <button
            type="button"
            onClick={() => deleteAttachment.mutate()}
            className="mt-2 text-sm text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50"
          >
            Anhang löschen
          </button>
        </div>
      )}

      <hr className="my-4 border-gray-100" />
      <h2 className="font-semibold mb-2">Kommentare</h2>
      <ul className="space-y-2 mb-3">
        {comments?.map((c) => (
          <li key={c.id} className="text-sm bg-gray-50 border border-gray-100 rounded-lg p-2.5">
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
          className="input flex-1 text-sm"
        />
        <button type="submit" className="btn-primary text-sm px-3 py-1.5 min-h-0">
          Senden
        </button>
      </form>
    </div>
  );
}
