import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Item } from "../lib/types";

const TYPE_LABELS: Record<string, string> = { IDEA: "Idee", TASK: "Aufgabe" };

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);

  const { data: items, isFetching } = useQuery<Item[]>({
    queryKey: ["items-search", initialQuery],
    queryFn: () => api.get(`/items?q=${encodeURIComponent(initialQuery)}`),
    enabled: initialQuery.trim().length > 0,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams(query.trim() ? { q: query.trim() } : {});
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Suche</h1>

      <form onSubmit={submit} className="flex gap-2 mb-6">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Titel oder Beschreibung durchsuchen…"
          className="flex-1 border rounded px-3 py-2 min-h-[44px]"
        />
        <button
          type="submit"
          className="px-4 py-2 min-h-[44px] rounded bg-gray-900 text-white text-sm"
        >
          Suchen
        </button>
      </form>

      {!initialQuery.trim() && <p className="text-gray-500 text-sm">Gib einen Suchbegriff ein.</p>}

      {initialQuery.trim() && isFetching && <p className="text-gray-500 text-sm">Suche läuft…</p>}

      {initialQuery.trim() && !isFetching && items && items.length === 0 && (
        <p className="text-gray-500 text-sm">Keine Treffer für „{initialQuery}".</p>
      )}

      {items && items.length > 0 && (
        <ul className="space-y-1 text-sm bg-white border rounded-lg overflow-hidden">
          {items.map((item) => (
            <li key={item.id} className="border-t first:border-t-0">
              <Link to={`/items/${item.id}`} className="block px-3 py-2 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {TYPE_LABELS[item.type] ?? item.type} · {item.status}
                  </span>
                </div>
                {item.description && (
                  <p className="text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
