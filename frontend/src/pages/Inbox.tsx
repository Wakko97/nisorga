import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Item, User } from "../lib/types";
import QuickCapture from "../components/QuickCapture";

export default function Inbox() {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useQuery<Item[]>({
    queryKey: ["items", { status: "INBOX" }],
    queryFn: () => api.get("/items?status=INBOX"),
  });
  const { data: users } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  const updateItem = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Item> }) => api.patch(`/items/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Inbox</h1>
      <QuickCapture />

      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {items && items.length === 0 && (
        <p className="text-gray-500">Keine offenen Inbox-Einträge. Sehr gut aufgeräumt!</p>
      )}

      <ul className="space-y-2">
        {items?.map((item) => (
          <li key={item.id} className="bg-white border rounded-lg p-3 flex flex-wrap items-center gap-3">
            <Link to={`/items/${item.id}`} className="font-medium hover:underline flex-1 min-w-[150px]">
              {item.title}
            </Link>

            <select
              value={item.type}
              onChange={(e) =>
                updateItem.mutate({ id: item.id, data: { type: e.target.value as Item["type"] } })
              }
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="IDEA">Idee</option>
              <option value="TASK">Aufgabe</option>
            </select>

            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={item.important}
                onChange={(e) => updateItem.mutate({ id: item.id, data: { important: e.target.checked } })}
              />
              wichtig
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={item.urgent}
                onChange={(e) => updateItem.mutate({ id: item.id, data: { urgent: e.target.checked } })}
              />
              dringend
            </label>

            <select
              value={item.assignedToId ?? ""}
              onChange={(e) =>
                updateItem.mutate({ id: item.id, data: { assignedToId: e.target.value || null } })
              }
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="">Nicht zugewiesen</option>
              {users?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            <button
              onClick={() =>
                updateItem.mutate({
                  id: item.id,
                  data: { status: item.type === "TASK" ? "TODO" : "TODO" },
                })
              }
              className="text-sm px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
            >
              Verschieben nach To-do
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
