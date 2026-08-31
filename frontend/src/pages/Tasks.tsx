import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Item, User, ItemStatus } from "../lib/types";
import { daysSince, isWaitingOverdue } from "../lib/waiting";
import { useAuth } from "../context/AuthContext";
import BulkActionBar from "../components/BulkActionBar";

const STATUSES: ItemStatus[] = ["TODO", "IN_PROGRESS", "WAITING", "DONE"];

function WaitingBadge({ item, overdueDays }: { item: Item; overdueDays?: number }) {
  if (!isWaitingOverdue(item.status, item.waitingSince, overdueDays)) return null;
  return (
    <span className="ml-2 inline-block text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
      überfällig, wartet seit {daysSince(item.waitingSince!)} Tagen
    </span>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string>("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: items } = useQuery<Item[]>({
    queryKey: ["items", { type: "TASK" }],
    queryFn: () => api.get("/items?type=TASK"),
  });
  const { data: users } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  const filtered = (items ?? []).filter((item) => {
    if (status && item.status !== status) return false;
    if (assignedTo && item.assignedToId !== assignedTo) return false;
    return true;
  });

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((i) => i.id))
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Aufgaben</h1>

      <BulkActionBar selectedIds={selected} users={users} onCleared={() => setSelected(new Set())} />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border rounded px-2 py-2 min-h-[44px]"
        >
          <option value="">Alle Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          className="border rounded px-2 py-2 min-h-[44px]"
        >
          <option value="">Alle Zuweisungen</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[640px] bg-white border rounded-lg overflow-hidden text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2 w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  aria-label="Alle auswählen"
                  className="h-5 w-5 p-1"
                />
              </th>
              <th className="p-2">Titel</th>
              <th className="p-2">Status</th>
              <th className="p-2">Zugewiesen</th>
              <th className="p-2">Fällig</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    aria-label={`${item.title} auswählen`}
                    className="h-5 w-5 p-1.5"
                  />
                </td>
                <td className="p-2">
                  <Link to={`/items/${item.id}`} className="hover:underline block py-1">
                    {item.title}
                  </Link>
                </td>
                <td className="p-2">
                  {item.status}
                  <WaitingBadge item={item} overdueDays={user?.waitingReminderDays} />
                </td>
                <td className="p-2">{item.assignedTo?.name ?? "—"}</td>
                <td className="p-2">{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-500">
                  Keine Aufgaben gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
