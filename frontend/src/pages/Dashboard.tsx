import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface DashboardStats {
  windowDays: number;
  completedCount: number;
  createdCount: number;
  completionRate: number | null;
  avgLeadTimeDays: number | null;
  openCount: number;
  openByAssignee: { user: { id: string; name: string } | null; count: number }[];
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel">
      <p className="label">{label}</p>
      <p className="text-3xl font-extrabold text-gray-900">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: () => api.get("/dashboard/stats"),
  });

  if (isLoading || !data) return <p className="text-gray-500">Lädt…</p>;

  const maxCount = Math.max(1, ...data.openByAssignee.map((e) => e.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-gray-500">Kennzahlen der letzten {data.windowDays} Tage.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Erledigungsquote"
          value={data.completionRate !== null ? `${Math.round(data.completionRate * 100)}%` : "–"}
          hint={`${data.completedCount} von ${data.createdCount} erledigt`}
        />
        <StatCard
          label="Ø Durchlaufzeit"
          value={data.avgLeadTimeDays !== null ? `${data.avgLeadTimeDays.toFixed(1)} Tage` : "–"}
          hint="von Erstellung bis Erledigung"
        />
        <StatCard label="Offene Items" value={String(data.openCount)} />
        <StatCard label="Erledigt (30 Tage)" value={String(data.completedCount)} />
      </div>

      <div className="panel">
        <h2 className="font-semibold mb-4">Offene Items pro Person</h2>
        {data.openByAssignee.length === 0 ? (
          <p className="text-sm text-gray-500">Keine offenen Items 🎉</p>
        ) : (
          <ul className="space-y-2">
            {data.openByAssignee.map((entry) => (
              <li key={entry.user?.id ?? "unassigned"} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-sm text-gray-700 truncate">
                  {entry.user?.name ?? "Nicht zugewiesen"}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-brand-500 h-full rounded-full"
                    style={{ width: `${(entry.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-right text-sm font-medium text-gray-600">{entry.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
