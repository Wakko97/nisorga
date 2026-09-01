import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, downloadFile } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { ApiKeyInfo, WebhookSubscription, MailSettings, AppSettings } from "../lib/types";

const EVENT_OPTIONS = ["item.created", "item.updated"];

interface GoogleForm {
  clientId: string;
  redirectUri: string;
  clientSecret: string;
}

const EMPTY_GOOGLE_FORM: GoogleForm = { clientId: "", redirectUri: "", clientSecret: "" };

interface SmtpForm {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  password: string;
}

interface ImapForm {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  mailbox: string;
  inboundDomain: string;
  password: string;
}

const EMPTY_SMTP_FORM: SmtpForm = { host: "", port: 587, secure: false, user: "", fromEmail: "", password: "" };
const EMPTY_IMAP_FORM: ImapForm = {
  host: "",
  port: 993,
  secure: true,
  user: "",
  mailbox: "INBOX",
  inboundDomain: "",
  password: "",
};

export default function Settings() {
  const [searchParams] = useSearchParams();
  const googleParam = searchParams.get("google");
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";
  const [exportError, setExportError] = useState<string | null>(null);
  const push = usePushNotifications();

  // Two-factor authentication (TOTP) setup/enable/disable.
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [showDisable2fa, setShowDisable2fa] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  const startTwoFactorSetup = useMutation({
    mutationFn: () => api.post<{ secret: string; qrCodeDataUrl: string }>("/auth/2fa/setup"),
    onSuccess: (data) => {
      setTwoFactorSetup(data);
      setTwoFactorError(null);
    },
  });

  const confirmTwoFactorSetup = useMutation({
    mutationFn: (token: string) => api.post<{ backupCodes: string[] }>("/auth/2fa/enable", { token }),
    onSuccess: (data) => {
      setTwoFactorSetup(null);
      setConfirmCode("");
      setBackupCodes(data.backupCodes);
      setTwoFactorError(null);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => setTwoFactorError("Code ungültig."),
  });

  const disableTwoFactor = useMutation({
    mutationFn: (password: string) => api.post("/auth/2fa/disable", { password }),
    onSuccess: () => {
      setShowDisable2fa(false);
      setDisablePassword("");
      setTwoFactorError(null);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => setTwoFactorError("Passwort ungültig."),
  });

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

  // Mail configuration (SMTP send + IMAP receive) — Owner only. Only
  // fetched for an Owner: a Member would just get a 403.
  const { data: mailSettings } = useQuery<MailSettings>({
    queryKey: ["settings-mail"],
    queryFn: () => api.get("/settings/mail"),
    enabled: isOwner,
  });

  const [smtpForm, setSmtpForm] = useState<SmtpForm>(EMPTY_SMTP_FORM);
  const [imapForm, setImapForm] = useState<ImapForm>(EMPTY_IMAP_FORM);
  const [smtpSaved, setSmtpSaved] = useState(false);
  const [imapSaved, setImapSaved] = useState(false);

  // Populate the forms once the current settings arrive - passwords are
  // never sent back by the API, so that field always starts empty (an
  // empty field on save means "leave the stored password unchanged").
  useEffect(() => {
    if (!mailSettings) return;
    setSmtpForm({ ...mailSettings.smtp, password: "" });
    setImapForm({ ...mailSettings.imap, password: "" });
  }, [mailSettings]);

  const saveSmtp = useMutation({
    mutationFn: (form: SmtpForm) => {
      const { password, ...rest } = form;
      return api.put("/settings/mail", { smtp: password ? { ...rest, password } : rest });
    },
    onSuccess: () => {
      setSmtpSaved(true);
      setTimeout(() => setSmtpSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["settings-mail"] });
    },
  });

  const saveImap = useMutation({
    mutationFn: (form: ImapForm) => {
      const { password, ...rest } = form;
      return api.put("/settings/mail", { imap: password ? { ...rest, password } : rest });
    },
    onSuccess: () => {
      setImapSaved(true);
      setTimeout(() => setImapSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["settings-mail"] });
    },
  });

  // App-wide configuration (Google OAuth + delegation reminder threshold)
  // — Owner only, same pattern as mail settings above.
  const { data: appSettings } = useQuery<AppSettings>({
    queryKey: ["settings-app"],
    queryFn: () => api.get("/settings/app"),
    enabled: isOwner,
  });

  const [googleForm, setGoogleForm] = useState<GoogleForm>(EMPTY_GOOGLE_FORM);
  const [reminderDays, setReminderDays] = useState(3);
  const [googleSaved, setGoogleSaved] = useState(false);
  const [reminderSaved, setReminderSaved] = useState(false);

  useEffect(() => {
    if (!appSettings) return;
    setGoogleForm({ ...appSettings.google, clientSecret: "" });
    setReminderDays(appSettings.waitingReminderDays);
  }, [appSettings]);

  const saveGoogle = useMutation({
    mutationFn: (form: GoogleForm) => {
      const { clientSecret, ...rest } = form;
      return api.put("/settings/app", { google: clientSecret ? { ...rest, clientSecret } : rest });
    },
    onSuccess: () => {
      setGoogleSaved(true);
      setTimeout(() => setGoogleSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["settings-app"] });
    },
  });

  const saveReminderDays = useMutation({
    mutationFn: (days: number) => api.put("/settings/app", { waitingReminderDays: days }),
    onSuccess: () => {
      setReminderSaved(true);
      setTimeout(() => setReminderSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["settings-app"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-semibold">Einstellungen</h1>

      <section className="bg-white border rounded-lg p-4">
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
          className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white"
        >
          {googleStatus?.connected ? "Neu verbinden" : "Google Kalender verbinden"}
        </button>
      </section>

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Push-Benachrichtigungen</h2>
        {push.state === "unsupported" && (
          <p className="text-sm text-gray-500">Dein Browser unterstützt keine Push-Benachrichtigungen.</p>
        )}
        {push.state === "loading" && <p className="text-sm text-gray-500">Lädt…</p>}
        {(push.state === "subscribed" || push.state === "unsubscribed") && (
          <>
            <p className="text-sm mb-3">
              Erhalte Delegations-Erinnerungen (überfällige „Wartet auf Rückmeldung"-Punkte) zusätzlich zur E-Mail
              als Browser-Benachrichtigung auf diesem Gerät.
            </p>
            <button
              onClick={() => (push.state === "subscribed" ? push.unsubscribe() : push.subscribe())}
              className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white"
            >
              {push.state === "subscribed" ? "Auf diesem Gerät deaktivieren" : "Aktivieren"}
            </button>
            {push.error && <p className="text-red-600 text-xs mt-2">{push.error}</p>}
          </>
        )}
      </section>

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Zwei-Faktor-Authentifizierung (2FA)</h2>

        {!user?.twoFactorEnabled && !twoFactorSetup && !backupCodes && (
          <>
            <p className="text-sm text-gray-600 mb-3">
              Schützt dein Konto zusätzlich mit einem Code aus einer Authenticator-App (z. B. Google Authenticator,
              Aegis, 1Password).
            </p>
            <button
              onClick={() => startTwoFactorSetup.mutate()}
              className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white"
            >
              Aktivieren
            </button>
          </>
        )}

        {twoFactorSetup && (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              QR-Code mit der Authenticator-App scannen (oder den Code manuell eingeben) und danach den
              6-stelligen Code zur Bestätigung eintragen.
            </p>
            <img src={twoFactorSetup.qrCodeDataUrl} alt="2FA-QR-Code" className="mb-2 border rounded" width={200} height={200} />
            <p className="text-xs text-gray-500 mb-3 font-mono break-all">{twoFactorSetup.secret}</p>
            <div className="flex gap-2">
              <input
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="6-stelliger Code"
                inputMode="numeric"
                className="flex-1 border rounded px-3 py-2 text-sm"
              />
              <button
                onClick={() => confirmTwoFactorSetup.mutate(confirmCode)}
                className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white"
              >
                Bestätigen
              </button>
            </div>
            {twoFactorError && <p className="text-red-600 text-xs mt-2">{twoFactorError}</p>}
          </div>
        )}

        {backupCodes && (
          <div>
            <p className="text-sm text-green-700 mb-2">2FA ist aktiviert. Backup-Codes (jeder nur einmal gültig, jetzt sichern — sie werden nicht erneut angezeigt):</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm bg-gray-50 border rounded p-3 mb-3">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <button
              onClick={() => setBackupCodes(null)}
              className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100"
            >
              Gesichert, ausblenden
            </button>
          </div>
        )}

        {user?.twoFactorEnabled && !backupCodes && !twoFactorSetup && (
          <div>
            <p className="text-sm text-green-700 mb-3">2FA ist aktiviert.</p>
            {!showDisable2fa ? (
              <button
                onClick={() => setShowDisable2fa(true)}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100"
              >
                Deaktivieren
              </button>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Passwort zur Bestätigung"
                  className="flex-1 border rounded px-3 py-2 text-sm"
                />
                <button
                  onClick={() => disableTwoFactor.mutate(disablePassword)}
                  className="text-sm px-3 py-1.5 rounded bg-red-600 text-white"
                >
                  Deaktivieren
                </button>
              </div>
            )}
            {twoFactorError && <p className="text-red-600 text-xs mt-2">{twoFactorError}</p>}
          </div>
        )}
      </section>

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-2">E-Mail-Erfassung</h2>
        <p className="text-sm mb-3">
          Sende eine E-Mail an diese Adresse, um sie automatisch als Idee in deiner Inbox zu erfassen:
        </p>
        <div className="flex gap-2 mb-2">
          <code className="flex-1 border rounded px-3 py-1.5 text-sm bg-gray-50 overflow-x-auto">
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
            className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100"
          >
            {copied ? "Kopiert!" : "Kopieren"}
          </button>
          <button
            onClick={() => regenerateEmail.mutate()}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100"
          >
            Neu generieren
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Zusätzlich erhältst du freitags einen wöchentlichen Rückblick per E-Mail mit offenen Inbox-Punkten,
          überfälligen Aufgaben und unbearbeiteten Ideen.
        </p>
      </section>

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Daten-Export</h2>
        <p className="text-sm text-gray-600 mb-3">
          Lädt alle für dich sichtbaren Items (Owner: alle, Mitglieder: eigene/zugewiesene) herunter.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() =>
              downloadFile("/items/export?format=csv", "nisorga-items.csv").catch(() =>
                setExportError("Export fehlgeschlagen.")
              )
            }
            className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100"
          >
            Als CSV exportieren
          </button>
          <button
            onClick={() =>
              downloadFile("/items/export?format=json", "nisorga-items.json").catch(() =>
                setExportError("Export fehlgeschlagen.")
              )
            }
            className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100"
          >
            Als JSON exportieren
          </button>
        </div>
        {exportError && <p className="text-red-600 text-xs mt-2">{exportError}</p>}
      </section>

      {isOwner && (
        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-1">Mail-Konfiguration</h2>
          <p className="text-xs text-gray-500 mb-4">
            Gilt für die ganze Instanz (nicht pro Nutzer:in). Überschreibt die entsprechenden
            SMTP_*/IMAP_*-Umgebungsvariablen, falls dort ebenfalls etwas gesetzt ist.
          </p>

          <h3 className="text-sm font-medium mb-2">Ausgehend (SMTP)</h3>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              value={smtpForm.host}
              onChange={(e) => setSmtpForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="Host (smtp.example.com)"
              className="col-span-2 border rounded px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={smtpForm.port}
              onChange={(e) => setSmtpForm((f) => ({ ...f, port: Number(e.target.value) }))}
              placeholder="Port"
              className="border rounded px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={smtpForm.secure}
                onChange={(e) => setSmtpForm((f) => ({ ...f, secure: e.target.checked }))}
              />
              TLS (Port 465)
            </label>
            <input
              value={smtpForm.user}
              onChange={(e) => setSmtpForm((f) => ({ ...f, user: e.target.value }))}
              placeholder="Benutzername"
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              type="password"
              value={smtpForm.password}
              onChange={(e) => setSmtpForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={mailSettings?.smtp.passwordSet ? "•••••• (gesetzt, leer lassen zum Beibehalten)" : "Passwort"}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              value={smtpForm.fromEmail}
              onChange={(e) => setSmtpForm((f) => ({ ...f, fromEmail: e.target.value }))}
              placeholder="Absenderadresse (noreply@...)"
              className="col-span-2 border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => saveSmtp.mutate(smtpForm)}
            className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white mb-6"
          >
            {smtpSaved ? "Gespeichert!" : "SMTP speichern"}
          </button>

          <h3 className="text-sm font-medium mb-2">Eingehend (IMAP)</h3>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              value={imapForm.host}
              onChange={(e) => setImapForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="Host (imap.example.com)"
              className="col-span-2 border rounded px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={imapForm.port}
              onChange={(e) => setImapForm((f) => ({ ...f, port: Number(e.target.value) }))}
              placeholder="Port"
              className="border rounded px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={imapForm.secure}
                onChange={(e) => setImapForm((f) => ({ ...f, secure: e.target.checked }))}
              />
              TLS
            </label>
            <input
              value={imapForm.user}
              onChange={(e) => setImapForm((f) => ({ ...f, user: e.target.value }))}
              placeholder="Benutzername"
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              type="password"
              value={imapForm.password}
              onChange={(e) => setImapForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={mailSettings?.imap.passwordSet ? "•••••• (gesetzt, leer lassen zum Beibehalten)" : "Passwort"}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              value={imapForm.mailbox}
              onChange={(e) => setImapForm((f) => ({ ...f, mailbox: e.target.value }))}
              placeholder="Mailbox (INBOX)"
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              value={imapForm.inboundDomain}
              onChange={(e) => setImapForm((f) => ({ ...f, inboundDomain: e.target.value }))}
              placeholder="Inbound-Domain (inbound.example.com)"
              className="col-span-2 border rounded px-3 py-2 text-sm"
            />
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Die Inbound-Domain muss alle an sie adressierten Mails in dieses Postfach zustellen (Catch-All oder
            Plus-Adressierung) — siehe README, Abschnitt „E-Mail (SMTP/IMAP) einrichten".
          </p>
          <button
            onClick={() => saveImap.mutate(imapForm)}
            className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white"
          >
            {imapSaved ? "Gespeichert!" : "IMAP speichern"}
          </button>
        </section>
      )}

      {isOwner && (
        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-1">App-Konfiguration</h2>
          <p className="text-xs text-gray-500 mb-4">
            Gilt für die ganze Instanz. Überschreibt die entsprechenden Umgebungsvariablen, falls dort ebenfalls
            etwas gesetzt ist.
          </p>

          <h3 className="text-sm font-medium mb-2">Google-OAuth-Zugangsdaten</h3>
          <p className="text-xs text-gray-500 mb-2">
            Aus der Google Cloud Console (siehe README, Abschnitt „Google-Kalender-Integration einrichten").
          </p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              value={googleForm.clientId}
              onChange={(e) => setGoogleForm((f) => ({ ...f, clientId: e.target.value }))}
              placeholder="Client-ID"
              className="col-span-2 border rounded px-3 py-2 text-sm"
            />
            <input
              type="password"
              value={googleForm.clientSecret}
              onChange={(e) => setGoogleForm((f) => ({ ...f, clientSecret: e.target.value }))}
              placeholder={appSettings?.google.secretSet ? "•••••• (gesetzt, leer lassen zum Beibehalten)" : "Client-Secret"}
              className="col-span-2 border rounded px-3 py-2 text-sm"
            />
            <input
              value={googleForm.redirectUri}
              onChange={(e) => setGoogleForm((f) => ({ ...f, redirectUri: e.target.value }))}
              placeholder="Redirect-URI (https://<backend-host>/integrations/google/callback)"
              className="col-span-2 border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => saveGoogle.mutate(googleForm)}
            className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white mb-6"
          >
            {googleSaved ? "Gespeichert!" : "Google-Zugangsdaten speichern"}
          </button>

          <h3 className="text-sm font-medium mb-2">Delegations-Erinnerung</h3>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="number"
              min={1}
              value={reminderDays}
              onChange={(e) => setReminderDays(Number(e.target.value))}
              className="w-24 border rounded px-3 py-2 text-sm"
            />
            <span className="text-sm text-gray-600">
              Tage, nach denen ein auf „Wartet auf Rückmeldung" stehender Punkt als überfällig gilt und eine
              Erinnerung verschickt wird.
            </span>
          </div>
          <button
            onClick={() => saveReminderDays.mutate(reminderDays)}
            className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white"
          >
            {reminderSaved ? "Gespeichert!" : "Speichern"}
          </button>
        </section>
      )}

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-2">API-Keys</h2>
        <div className="flex gap-2 mb-3">
          <input
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
            placeholder="Bezeichnung (z.B. Zapier)"
            className="flex-1 border rounded px-3 py-2 min-h-[44px] text-sm"
          />
          <button
            onClick={() => newKeyLabel.trim() && createApiKey.mutate(newKeyLabel.trim())}
            className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white"
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
            <li key={k.id} className="flex items-center justify-between border-t py-1">
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

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-2">Webhooks</h2>
        <div className="flex gap-2 mb-2">
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://example.com/webhook"
            className="flex-1 border rounded px-3 py-2 min-h-[44px] text-sm"
          />
          <button
            onClick={() => webhookUrl && webhookEvents.length > 0 && createWebhook.mutate()}
            className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white"
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
            <li key={w.id} className="flex items-center justify-between border-t py-1">
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
