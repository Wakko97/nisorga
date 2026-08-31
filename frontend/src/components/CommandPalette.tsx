import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: (navigate: ReturnType<typeof useNavigate>) => void;
}

const COMMANDS: Command[] = [
  { id: "inbox", label: "Zur Inbox", hint: "g i", run: (nav) => nav("/inbox") },
  { id: "matrix", label: "Zur Eisenhower-Matrix", run: (nav) => nav("/matrix") },
  { id: "tasks", label: "Zu den Aufgaben", run: (nav) => nav("/tasks") },
  { id: "dashboard", label: "Zum Dashboard", run: (nav) => nav("/dashboard") },
  { id: "review", label: "Zum Wochenrückblick", run: (nav) => nav("/review") },
  { id: "settings", label: "Zu den Einstellungen", run: (nav) => nav("/settings") },
  { id: "new-idea", label: "Neue Idee erfassen", hint: "n", run: (nav) => nav("/inbox?focus=capture") },
];

/**
 * Global ⌘K/Ctrl+K command palette for keyboard-driven navigation. Rendered
 * once in Layout so it's available on every authenticated page. `open`/
 * `onOpenChange` are lifted to Layout so a header button can also trigger it.
 */
export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const filtered = useMemo(
    () => COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
    [query]
  );

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Wait for the modal to mount before focusing.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runCommand(command: Command) {
    command.run(navigate);
    onOpenChange(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onOpenChange(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[activeIndex]) {
      e.preventDefault();
      runCommand(filtered[activeIndex]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4"
      onClick={() => onOpenChange(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Befehlspalette"
    >
      <div
        className="w-full max-w-lg card shadow-popover overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Befehl suchen oder Seite ansteuern…"
          className="w-full px-4 py-3 text-sm border-b border-gray-100 focus:outline-none"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">Keine Treffer.</li>}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => runCommand(c)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left ${
                  i === activeIndex ? "bg-brand-50 text-brand-800" : "text-gray-700"
                }`}
              >
                <span>{c.label}</span>
                {c.hint && <span className="badge-neutral">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
