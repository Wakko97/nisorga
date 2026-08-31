import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useSetupStatus } from "../context/AuthContext";

export default function Register() {
  const { data: setupStatus } = useSetupStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await api.post("/auth/register", { email, password, name });
      queryClient.setQueryData(["me"], user);
      navigate("/inbox");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registrierung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface-muted to-brand-100 px-4">
      <div className="w-full max-w-sm">
        <p className="text-center font-extrabold text-2xl tracking-tight text-brand-700 mb-6">Nisorga</p>
        <form onSubmit={handleSubmit} className="card p-7">
        <h1 className="text-xl font-bold tracking-tight mb-1 text-gray-900">Registrieren</h1>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <label htmlFor="register-name" className="block text-sm mb-1">Name</label>
        <input
          id="register-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input mb-3"
        />
        <label htmlFor="register-email" className="block text-sm mb-1">E-Mail</label>
        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="input mb-3"
        />
        <label htmlFor="register-password" className="block text-sm mb-1">Passwort</label>
        <input
          id="register-password"
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
          {loading ? "…" : "Registrieren"}
        </button>
        <p className="text-sm text-gray-500 mt-3">
          Schon registriert?{" "}
          <Link to="/login" className="text-brand-700 font-medium hover:underline">
            Anmelden
          </Link>
        </p>
        {setupStatus?.initialized === false && (
          <p className="text-sm text-gray-500 mt-2">
            Erststart?{" "}
            <Link to="/setup" className="text-brand-700 font-medium hover:underline">
              Zur Einrichtung
            </Link>
          </p>
        )}
        </form>
      </div>
    </div>
  );
}
