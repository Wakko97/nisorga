import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Item } from "../lib/types";
import { daysSince, isWaitingOverdue } from "../lib/waiting";
import { useAuth } from "../context/AuthContext";

const QUADRANTS: { key: string; important: boolean; urgent: boolean; label: string; color: string }[] = [
  { key: "do", important: true, urgent: true, label: "Wichtig & Dringend — Sofort erledigen", color: "bg-red-50/60 border-red-200" },
  { key: "plan", important: true, urgent: false, label: "Wichtig, nicht dringend — Planen", color: "bg-brand-50 border-brand-200" },
  { key: "delegate", important: false, urgent: true, label: "Dringend, nicht wichtig — Delegieren", color: "bg-amber-50 border-amber-200" },
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
      style={{ ...style, touchAction: "none" }}
      {...listeners}
      {...attributes}
      className="card p-2.5 mb-2 cursor-grab active:cursor-grabbing touch-none hover:shadow-popover transition-shadow"
    >
      <Link to={`/items/${item.id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-medium hover:text-brand-700 hover:underline">
        {item.title}
      </Link>
      {isWaitingOverdue(item.status, item.waitingSince, overdueDays) && (
        <span className="badge-danger mt-1 w-fit">
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
      className={`border-2 rounded-xl p-3 min-h-[220px] transition-shadow ${quadrant.color} ${isOver ? "ring-2 ring-brand-500" : ""}`}
    >
      <h3 className="text-sm font-semibold mb-2 text-gray-700">{quadrant.label}</h3>
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

  // PointerSensor covers mouse, touch and pen (incl. S-Pen) pointer input.
  // TouchSensor is added explicitly with an activation delay so a finger/pen
  // swipe used to scroll the page isn't immediately hijacked as a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

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
      <h1 className="text-2xl font-bold tracking-tight mb-4">Eisenhower-Matrix</h1>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
