import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth, useLogout } from "../context/AuthContext";
import { api } from "../lib/api";
import BottomNav from "./BottomNav";

const navItems = [
  { to: "/inbox", label: "Inbox" },
  { to: "/matrix", label: "Matrix" },
  { to: "/tasks", label: "Aufgaben" },
  { to: "/review", label: "Wochenrückblick" },
  { to: "/settings", label: "Einstellungen" },
];

export default function Layout() {
  const { user } = useAuth();
  const logout = useLogout();
  const [resent, setResent] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      {user && user.emailVerified === false && (
        <div
          className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
          style={{ paddingTop: "calc(var(--safe-top) + 0.5rem)" }}
        >
          <span>Bitte bestätige deine E-Mail-Adresse, um alle Funktionen (z.B. Erinnerungsmails) zu nutzen.</span>
          {resent ? (
            <span className="text-amber-700">Mail erneut gesendet.</span>
          ) : (
            <button
              onClick={() => api.post("/auth/resend-verification").then(() => setResent(true))}
              className="underline hover:no-underline self-start sm:self-auto min-h-[44px] sm:min-h-0"
            >
              Erneut senden
            </button>
          )}
        </div>
      )}
      <header
        className="border-b bg-white sticky top-0 z-10"
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6 min-w-0">
            <span className="font-semibold text-lg shrink-0">Nisorga</span>
            {/* Desktop/tablet nav — hidden on narrow screens in favor of the bottom tab bar. */}
            <nav className="hidden md:flex gap-4">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `text-sm px-2 py-1 rounded ${
                      isActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-600 shrink-0">
            <span className="hidden sm:inline">
              {user?.name} ({user?.role === "OWNER" ? "Owner" : "Mitglied"})
            </span>
            <button
              onClick={() => logout()}
              className="px-3 py-2 min-h-[44px] rounded border border-gray-300 hover:bg-gray-100"
            >
              Abmelden
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 pb-24 md:pb-6">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
