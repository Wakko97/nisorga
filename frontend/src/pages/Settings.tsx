import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ApiKeyInfo, WebhookSubscription } from "../lib/types";

const EVENT_OPTIONS = ["item.created", "item.updated"];

export default function Settings() {
  const [searchParams] = useSearchParams();
  const googleParam = searchParams.get("google");
  const queryClient = useQueryClient();

  const { data: googleStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["google-status"],
    queryFn: () => api.get("/integrations/google/status"),
  });

  const connectGoogle = useMutation({
    mutationFn: () => api.get<{ url: string }>("/integrations/google/auth-url"),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const { data: apiKeys } = useQuery<ApiKeyInfo[]>({
    queryKey: ["api-keys"],
    queryFn: () => api.get("/settings/api-keys"),
  });
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const createApiKey = useMutation({
    mutationFn: (label: string) => api.post<ApiKeyInfo>("/settings/api-keys", { label }),
    onSuccess: (key) => {
      setNewlyCreatedKey(key.key ?? null);
      setNewKeyLabel("");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const deleteApiKey = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const { data: webhooks } = useQuery<WebhookSubscription[]>({
    queryKey: ["webhooks"],
    queryFn: () => api.get("/settings/webhooks"),
  });
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);

  const createWebhook = useMutation({
    mutationFn: () => api.post("/settings/webhooks", { url: webhookUrl, events: webhookEvents }),
    onSuccess: () => {
      setWebhookUrl("");
      setWebhookEvents([]);
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
  const deleteWebhook = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/webhooks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  const { data: emailSettings } = useQuery<{ address: string }>({
    queryKey: ["settings-email"],
    queryFn: () => api.get("/settings/email"),
  });
  const [copied, setCopied] = useState(false);
  const regenerateEmail = useMutation({
    mutationFn: () => api.post<{ address: string }>("/settings/email/regenerate"),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings-email"], data);
    },
  });

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Einstellungen</h1>

      <section className="panel">
        <h2 className="font-semibold mb-2">Google Kalender</h2>
        {googleParam === "connected" && (
          <p className="text-green-700 text-sm mb-2">Google Kalender wurde erfolgreich verbunden.</p>
        )}
        {googleParam === "error" && (
          <p className="text-red-700 text-sm mb-2">Verbindung mit Google fehlgeschlagen.</p>
        )}
        <p className="text-sm mb-3">
          Status: {googleStatus?.connected ? "Verbunden" : "Nicht verbunden"}
        </p>
        <button
          onClick={() => connectGoogle.mutate()}
          className="btn-primary text-sm px-3 py-1.5 min-h-0"
        >
          {googleStatus?.connected ? "Neu verbinden" : "Google Kalender verbinden"}
        </button>
      </section>

      <section className="panel">
        <h2 className="font-semibold mb-2">E-Mail-Erfassung</h2>
        <p className="text-sm mb-3">
          Sende eine E-Mail an diese Adresse, um sie automatisch als Idee in deiner Inbox zu erfassen:
        </p>
        <div className="flex gap-2 mb-2">
          <code className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm bg-gray-50 overflow-x-auto">
            {emailSettings?.address ?? "…"}
          </code>
          <button
            onClick={() => {
              if (emailSettings?.address) {
                navigator.clipboard.writeText(emailSettings.address);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className="btn-secondary text-sm px-3 py-1.5 min-h-0"
          >
            {copied ? "Kopiert!" : "Kopieren"}
          </button>
          <button
            onClick={() => regenerateEmail.mutate()}
            className="btn-secondary text-sm px-3 py-1.5 min-h-0"
          >
            Neu generieren
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Zusätzlich erhältst du freitags einen wöchentlichen Rückblick per E-Mail mit offenen Inbox-Punkten,
          überfälligen Aufgaben und unbearbeiteten Ideen.
        </p>
      </section>

      <section className="panel">
        <h2 className="font-semibold mb-2">API-Keys</h2>
        <div className="flex gap-2 mb-3">
          <input
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
            placeholder="Bezeichnung (z.B. Zapier)"
            className="input flex-1 text-sm"
          />
          <button
            onClick={() => newKeyLabel.trim() && createApiKey.mutate(newKeyLabel.trim())}
            className="btn-primary text-sm px-3 py-1.5 min-h-0"
          >
            Erzeugen
          </button>
        </div>
        {newlyCreatedKey && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3 text-sm">
            Neuer Key (nur jetzt sichtbar): <code className="font-mono">{newlyCreatedKey}</code>
          </div>
        )}
        <ul className="space-y-1 text-sm">
          {apiKeys?.map((k) => (
            <li key={k.id} className="flex items-center justify-between border-t border-gray-100 py-2">
              <span>
                {k.label} — erstellt {new Date(k.createdAt).toLocaleDateString()}
              </span>
              <button onClick={() => deleteApiKey.mutate(k.id)} className="text-red-600 text-xs">
                Löschen
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2 className="font-semibold mb-2">Webhooks</h2>
        <div className="flex gap-2 mb-2">
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://example.com/webhook"
            className="input flex-1 text-sm"
          />
          <button
            onClick={() => webhookUrl && webhookEvents.length > 0 && createWebhook.mutate()}
            className="btn-primary text-sm px-3 py-1.5 min-h-0"
          >
            Erzeugen
          </button>
        </div>
        <div className="flex gap-3 mb-3 text-sm">
          {EVENT_OPTIONS.map((ev) => (
            <label key={ev} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={webhookEvents.includes(ev)}
                onChange={(e) =>
                  setWebhookEvents((prev) =>
                    e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)
                  )
                }
              />
              {ev}
            </label>
          ))}
        </div>
        <ul className="space-y-1 text-sm">
          {webhooks?.map((w) => (
            <li key={w.id} className="flex items-center justify-between border-t border-gray-100 py-2">
              <span>
                {w.url} — {w.events.join(", ")}
              </span>
              <button onClick={() => deleteWebhook.mutate(w.id)} className="text-red-600 text-xs">
                Löschen
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
