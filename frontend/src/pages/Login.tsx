import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { LoginResponse } from "../lib/types";
import { useSetupStatus } from "../context/AuthContext";

export default function Login() {
  const { data: setupStatus } = useSetupStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Set once step 1 (email/password) succeeds but the account has 2FA
  // enabled - presence of this drives showing the code-entry step instead
  // of the password form.
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>("/auth/login", { email, password });
      if (res.twoFactorRequired && res.tempToken) {
        setTempToken(res.tempToken);
      } else {
        queryClient.setQueryData(["me"], res);
        navigate("/inbox");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = useBackupCode ? { tempToken, backupCode: code } : { tempToken, token: code };
      const user = await api.post("/auth/2fa/verify-login", body);
      queryClient.setQueryData(["me"], user);
      navigate("/inbox");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Anmeldung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  if (tempToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <form onSubmit={handleVerifyCode} className="w-full max-w-sm bg-white p-6 rounded-lg shadow border">
          <h1 className="text-xl font-semibold mb-4">Zwei-Faktor-Authentifizierung</h1>
          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
          <label htmlFor="login-2fa-code" className="block text-sm mb-1">
            {useBackupCode ? "Backup-Code" : "Code aus der Authenticator-App"}
          </label>
          <input
            id="login-2fa-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
            inputMode={useBackupCode ? "text" : "numeric"}
            className="w-full border rounded px-3 py-2 mb-4"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gray-900 text-white rounded py-2 hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "…" : "Bestätigen"}
          </button>
          <button
            type="button"
            onClick={() => {
              setUseBackupCode((v) => !v);
              setCode("");
              setError(null);
            }}
            className="w-full text-sm text-gray-500 underline mt-3"
          >
            {useBackupCode ? "Stattdessen Authenticator-Code verwenden" : "Stattdessen Backup-Code verwenden"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white p-6 rounded-lg shadow border">
        <h1 className="text-xl font-semibold mb-4">Anmelden</h1>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <label htmlFor="login-email" className="block text-sm mb-1">E-Mail</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border rounded px-3 py-2 mb-3"
        />
        <label htmlFor="login-password" className="block text-sm mb-1">Passwort</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full border rounded px-3 py-2 mb-4"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gray-900 text-white rounded py-2 hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? "…" : "Anmelden"}
        </button>
        <p className="text-sm text-gray-500 mt-3">
          Noch kein Konto?{" "}
          <Link to="/register" className="underline">
            Registrieren
          </Link>
        </p>
        {setupStatus?.initialized === false && (
          <p className="text-sm text-gray-500 mt-2">
            Erststart?{" "}
            <Link to="/setup" className="underline">
              Zur Einrichtung
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}
