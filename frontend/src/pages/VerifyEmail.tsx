import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Kein Bestätigungslink angegeben.");
      return;
    }
    api
      .post("/auth/verify-email", { token })
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setError(err instanceof ApiError ? err.message : "Bestätigung fehlgeschlagen.");
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-surface-muted to-brand-100 px-4">
      <div className="w-full max-w-sm card p-7 text-center">
        {status === "pending" && <p className="text-gray-600">E-Mail-Adresse wird bestätigt…</p>}
        {status === "success" && (
          <>
            <p className="mb-4 text-emerald-700 font-medium">Deine E-Mail-Adresse wurde bestätigt.</p>
            <Link to="/inbox" className="text-brand-700 font-medium hover:underline">
              Weiter zur App
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <p className="mb-4 text-red-700 font-medium">{error}</p>
            <Link to="/inbox" className="text-brand-700 font-medium hover:underline">
              Zur App
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
