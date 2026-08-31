import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useSetupStatus } from "../context/AuthContext";

type Step = 1 | 2 | 3;

function CheckRow({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span aria-hidden="true">{ok ? "✅" : "❌"}</span>
      <div>
        <p className="text-sm font-medium">{label}</p>
        {!ok && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    </li>
  );
}

export default function Setup() {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [alreadyInitialized, setAlreadyInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: status } = useSetupStatus();

  async function handleCreateOwner(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAlreadyInitialized(false);
    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    setLoading(true);
    try {
      const user = await api.post("/setup/init", { email, password, name });
      queryClient.setQueryData(["me"], user);
      queryClient.invalidateQueries({ queryKey: ["setup-status"] });
      setStep(3);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAlreadyInitialized(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Einrichtung fehlgeschlagen");
      }
    } finally {
      setLoading(false);
    }
  }

  function finish() {
    queryClient.invalidateQueries({ queryKey: ["me"] });
    queryClient.invalidateQueries({ queryKey: ["setup-status"] });
    navigate("/inbox");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface-muted to-brand-100 px-4">
      <div className="w-full max-w-md card p-7">
        {step === 1 && (
          <div>
            <h1 className="text-xl font-bold tracking-tight mb-4 text-gray-900">Willkommen bei Nisorga</h1>
            <p className="text-sm text-gray-600 mb-6">
              Nisorga hilft dir und deinem Team, Ideen und Aufgaben zu sammeln, zu priorisieren
              und im Blick zu behalten — von der Inbox über die Eisenhower-Matrix bis zum
              Wochenrückblick. Lass uns die App in ein paar Schritten einrichten.
            </p>
            <button
              onClick={() => setStep(2)}
              className="btn-primary w-full"
            >
              Weiter
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="text-xl font-bold tracking-tight mb-4 text-gray-900">Owner-Account anlegen</h1>
            {alreadyInitialized ? (
              <p className="text-sm text-red-600 mb-3">
                Die App wurde bereits eingerichtet.{" "}
                <a href="/login" className="text-brand-700 font-medium hover:underline">
                  Zum Login
                </a>
              </p>
            ) : (
              <form onSubmit={handleCreateOwner}>
                {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
                <label htmlFor="setup-name" className="block text-sm mb-1">Name</label>
                <input
                  id="setup-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="input mb-3"
                />
                <label htmlFor="setup-email" className="block text-sm mb-1">E-Mail</label>
                <input
                  id="setup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input mb-3"
                />
                <label htmlFor="setup-password" className="block text-sm mb-1">Passwort</label>
                <input
                  id="setup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="input mb-4"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full"
                >
                  {loading ? "…" : "Owner-Account anlegen"}
                </button>
              </form>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <h1 className="text-xl font-bold tracking-tight mb-4 text-gray-900">Server-Konfiguration</h1>
            <p className="text-sm text-gray-600 mb-3">
              Diese Einstellungen werden in der Umgebung des Servers (backend/.env) vorgenommen,
              nicht im Browser. Aktueller Status:
            </p>
            <ul className="divide-y divide-gray-100 mb-6">
              <CheckRow
                ok={!!status?.env.sendgridConfigured}
                label="E-Mail-Versand (SendGrid)"
                hint="nicht konfiguriert — SENDGRID_API_KEY etc. in backend/.env setzen, siehe README."
              />
              <CheckRow
                ok={!!status?.env.googleConfigured}
                label="Google Kalender"
                hint="nicht konfiguriert — Google-OAuth-Zugangsdaten in backend/.env setzen, siehe README."
              />
              <CheckRow
                ok={!!status?.env.emailInboundConfigured}
                label="E-Mail-Eingang (Items per Mail anlegen)"
                hint="nicht konfiguriert — Inbound-Mail-Webhook in backend/.env setzen, siehe README."
              />
            </ul>
            <button
              onClick={finish}
              className="btn-primary w-full"
            >
              Fertig
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
