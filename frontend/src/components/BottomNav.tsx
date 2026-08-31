import { NavLink } from "react-router-dom";

const items = [
  { to: "/inbox", label: "Inbox", icon: "📥" },
  { to: "/matrix", label: "Matrix", icon: "🧭" },
  { to: "/tasks", label: "Aufgaben", icon: "✅" },
  { to: "/review", label: "Rückblick", icon: "📆" },
  { to: "/settings", label: "Mehr", icon: "⚙️" },
];

/**
 * Thumb-reachable bottom tab bar, shown on narrow (mobile) viewports only.
 * Mirrors the desktop nav's items so there is a single source of routes.
 */
export default function BottomNav() {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t flex"
      style={{ paddingBottom: "var(--safe-bottom)" }}
      aria-label="Hauptnavigation"
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-xs ${
              isActive ? "text-gray-900 font-semibold" : "text-gray-500"
            }`
          }
        >
          <span className="text-lg leading-none" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
