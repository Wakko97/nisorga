import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Item, User, ItemStatus, Tag } from "../lib/types";
import { daysSince, isWaitingOverdue } from "../lib/waiting";
import { useAuth } from "../context/AuthContext";
import BulkActionBar from "../components/BulkActionBar";
import TagBadge from "../components/TagBadge";

const STATUSES: ItemStatus[] = ["TODO", "IN_PROGRESS", "WAITING", "DONE"];

function WaitingBadge({ item, overdueDays }: { item: Item; overdueDays?: number }) {
  if (!isWaitingOverdue(item.status, item.waitingSince, overdueDays)) return null;
  return (
    <span className="badge-danger ml-2">
      überfällig, wartet seit {daysSince(item.waitingSince!)} Tagen
    </span>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string>("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [tagId, setTagId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: items } = useQuery<Item[]>({
    queryKey: ["items", { type: "TASK" }],
    queryFn: () => api.get("/items?type=TASK"),
  });
  const { data: users } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });
  const { data: tags } = useQuery<Tag[]>({ queryKey: ["tags"], queryFn: () => api.get("/tags") });

  const filtered = (items ?? []).filter((item) => {
    if (status && item.status !== status) return false;
    if (assignedTo && item.assignedToId !== assignedTo) return false;
    if (tagId && !item.tags?.some(({ tag }) => tag.id === tagId)) return false;
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
      <h1 className="text-2xl font-bold tracking-tight mb-4">Aufgaben</h1>

      <BulkActionBar selectedIds={selected} users={users} onCleared={() => setSelected(new Set())} />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="select w-auto"
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
          className="select w-auto"
        >
          <option value="">Alle Zuweisungen</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="select w-auto">
          <option value="">Alle Tags</option>
          {tags?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[640px] card overflow-hidden text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-2.5 w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  aria-label="Alle auswählen"
                  className="h-5 w-5 p-1 accent-brand-600"
                />
              </th>
              <th className="p-2.5 font-medium">Titel</th>
              <th className="p-2.5 font-medium">Status</th>
              <th className="p-2.5 font-medium">Zugewiesen</th>
              <th className="p-2.5 font-medium">Fällig</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                <td className="p-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    aria-label={`${item.title} auswählen`}
                    className="h-5 w-5 p-1.5 accent-brand-600"
                  />
                </td>
                <td className="p-2.5">
                  <Link to={`/items/${item.id}`} className="hover:text-brand-700 hover:underline block py-1 font-medium">
                    {item.title}
                  </Link>
                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {item.tags.map(({ tag }) => (
                        <TagBadge key={tag.id} tag={tag} />
                      ))}
                    </div>
                  )}
                </td>
                <td className="p-2.5">
                  <span className="badge-neutral">{item.status}</span>
                  <WaitingBadge item={item} overdueDays={user?.waitingReminderDays} />
                </td>
                <td className="p-2.5 text-gray-600">{item.assignedTo?.name ?? "—"}</td>
                <td className="p-2.5 text-gray-600">{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "—"}</td>
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
