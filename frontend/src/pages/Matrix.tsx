import { DndContext, DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Item } from "../lib/types";
import { daysSince, isWaitingOverdue } from "../lib/waiting";
import { useAuth } from "../context/AuthContext";

const QUADRANTS: { key: string; important: boolean; urgent: boolean; label: string; color: string }[] = [
  { key: "do", important: true, urgent: true, label: "Wichtig & Dringend — Sofort erledigen", color: "bg-red-50 border-red-200" },
  { key: "plan", important: true, urgent: false, label: "Wichtig, nicht dringend — Planen", color: "bg-blue-50 border-blue-200" },
  { key: "delegate", important: false, urgent: true, label: "Dringend, nicht wichtig — Delegieren", color: "bg-yellow-50 border-yellow-200" },
  { key: "drop", important: false, urgent: false, label: "Weder noch — Streichen/Später", color: "bg-gray-50 border-gray-200" },
];

function DraggableCard({ item, overdueDays }: { item: Item; overdueDays?: number }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: item.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="bg-white border rounded p-2 mb-2 shadow-sm cursor-grab active:cursor-grabbing"
    >
      <Link to={`/items/${item.id}`} onClick={(e) => e.stopPropagation()} className="text-sm hover:underline">
        {item.title}
      </Link>
      {isWaitingOverdue(item.status, item.waitingSince, overdueDays) && (
        <span className="block mt-1 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 w-fit">
          überfällig, wartet seit {daysSince(item.waitingSince!)} Tagen
        </span>
      )}
    </div>
  );
}

function Quadrant({
  quadrant,
  items,
  overdueDays,
}: {
  quadrant: (typeof QUADRANTS)[number];
  items: Item[];
  overdueDays?: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: quadrant.key });
  return (
    <div
      ref={setNodeRef}
      className={`border-2 rounded-lg p-3 min-h-[220px] ${quadrant.color} ${isOver ? "ring-2 ring-gray-900" : ""}`}
    >
      <h3 className="text-sm font-semibold mb-2">{quadrant.label}</h3>
      {items.map((item) => (
        <DraggableCard key={item.id} item={item} overdueDays={overdueDays} />
      ))}
    </div>
  );
}

export default function Matrix() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: items } = useQuery<Item[]>({
    queryKey: ["items"],
    queryFn: () => api.get("/items"),
  });

  const updateItem = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Item> }) => api.patch(`/items/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const quadrant = QUADRANTS.find((q) => q.key === over.id);
    if (!quadrant) return;
    updateItem.mutate({
      id: String(active.id),
      data: { important: quadrant.important, urgent: quadrant.urgent },
    });
  }

  const visible = (items ?? []).filter((i) => i.status !== "DONE");

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Eisenhower-Matrix</h1>
      <DndContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-2 gap-4">
          {QUADRANTS.map((q) => (
            <Quadrant
              key={q.key}
              quadrant={q}
              items={visible.filter((i) => i.important === q.important && i.urgent === q.urgent)}
              overdueDays={user?.waitingReminderDays}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
