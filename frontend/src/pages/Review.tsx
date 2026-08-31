import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Item, User, WeeklyReview } from "../lib/types";

function ItemActions({ item, users }: { item: Item; users: User[] | undefined }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["review-weekly"] });

  const updateItem = useMutation({
    mutationFn: (data: Partial<Item>) => api.patch(`/items/${item.id}`, data),
    onSuccess: invalidate,
  });
  const convertItem = useMutation({
    mutationFn: () => api.post(`/items/${item.id}/convert`),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        onClick={() => updateItem.mutate({ important: true, urgent: true })}
        className="px-3 py-2 min-h-[44px] rounded border hover:bg-gray-100"
      >
        Wichtig &amp; dringend
      </button>
      <button
        onClick={() => updateItem.mutate({ important: true, urgent: false })}
        className="px-3 py-2 min-h-[44px] rounded border hover:bg-gray-100"
      >
        Nur wichtig
      </button>
      {item.type === "IDEA" && (
        <button
          onClick={() => convertItem.mutate()}
          className="px-3 py-2 min-h-[44px] rounded border hover:bg-gray-100"
        >
          Zu Aufgabe konvertieren
        </button>
      )}
      <select
        value={item.assignedToId ?? ""}
        onChange={(e) => updateItem.mutate({ assignedToId: e.target.value || null })}
        className="border rounded px-1.5 py-1"
      >
        <option value="">Nicht zugewiesen</option>
        {users?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => updateItem.mutate({ status: "DONE" })}
        className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
      >
        Archivieren
      </button>
    </div>
  );
}

function ReviewSection({
  title,
  hint,
  items,
  users,
}: {
  title: string;
  hint: string;
  items: Item[];
  users: User[] | undefined;
}) {
  return (
    <section className="bg-white border rounded-lg p-4">
      <h2 className="font-semibold mb-1">
        {title} <span className="text-gray-400 font-normal text-sm">({items.length})</span>
      </h2>
      <p className="text-xs text-gray-500 mb-3">{hint}</p>
      {items.length === 0 && <p className="text-sm text-gray-500">Nichts zu tun 🎉</p>}
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="border-t pt-3">
            <Link to={`/items/${item.id}`} className="font-medium hover:underline">
              {item.title}
            </Link>
            {item.dueDate && (
              <span className="ml-2 text-xs text-gray-500">
                fällig {new Date(item.dueDate).toLocaleDateString()}
              </span>
            )}
            <div className="mt-2">
              <ItemActions item={item} users={users} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Review() {
  const { data, isLoading } = useQuery<WeeklyReview>({
    queryKey: ["review-weekly"],
    queryFn: () => api.get("/review/weekly"),
  });
  const { data: users } = useQuery<User[]>({ queryKey: ["users"], queryFn: () => api.get("/users") });

  if (isLoading || !data) return <p className="text-gray-500">Lädt…</p>;

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Wochenrückblick</h1>
      <ReviewSection
        title="Offene Inbox-Punkte"
        hint="Noch nicht sortierte Ideen und Aufgaben."
        items={data.openInboxItems}
        users={users}
      />
      <ReviewSection
        title="Überfällige Aufgaben"
        hint="Aufgaben mit verstrichenem Fälligkeitsdatum."
        items={data.overdueTasks}
        users={users}
      />
      <ReviewSection
        title="Unbearbeitete Ideen"
        hint="Ideen, die seit mehr als 3 Tagen unangetastet in der Inbox liegen."
        items={data.staleIdeas}
        users={users}
      />
    </div>
  );
}
