import { Router } from "express";
import { prisma, publicUserSelect } from "../lib/prisma";
import { requireAuth, AuthUser } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

function visibilityWhere(user: AuthUser) {
  if (user.role === "OWNER") return {};
  return {
    OR: [{ createdById: user.id }, { assignedToId: user.id }],
  };
}

/**
 * Aggregated metrics for the dashboard: completion rate + average lead time
 * over the last 30 days, and (owner only) a per-member breakdown of open
 * items. Kept as simple grouped queries rather than raw SQL so the
 * visibility rules stay identical to the rest of the API.
 */
router.get("/stats", async (req, res) => {
  const user = req.user!;
  const where = visibilityWhere(user);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [doneRecent, createdRecent, openItems] = await Promise.all([
    prisma.item.findMany({
      where: { ...where, status: "DONE", updatedAt: { gte: since } },
      select: { createdAt: true, updatedAt: true },
    }),
    prisma.item.count({ where: { ...where, createdAt: { gte: since } } }),
    prisma.item.findMany({
      where: { ...where, status: { not: "DONE" } },
      select: { id: true, assignedToId: true, assignedTo: { select: publicUserSelect } },
    }),
  ]);

  const completedCount = doneRecent.length;
  const completionRate = createdRecent > 0 ? Math.min(1, completedCount / createdRecent) : null;

  const avgLeadTimeMs =
    doneRecent.length > 0
      ? doneRecent.reduce(
          (sum: number, i: { createdAt: Date; updatedAt: Date }) => sum + (i.updatedAt.getTime() - i.createdAt.getTime()),
          0,
        ) / doneRecent.length
      : null;
  const avgLeadTimeDays = avgLeadTimeMs !== null ? avgLeadTimeMs / (24 * 60 * 60 * 1000) : null;

  const openByAssignee = new Map<string, { user: { id: string; name: string } | null; count: number }>();
  for (const item of openItems) {
    const key = item.assignedToId ?? "unassigned";
    const entry = openByAssignee.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      openByAssignee.set(key, {
        user: item.assignedTo ? { id: item.assignedTo.id, name: item.assignedTo.name } : null,
        count: 1,
      });
    }
  }

  res.json({
    windowDays: 30,
    completedCount,
    createdCount: createdRecent,
    completionRate,
    avgLeadTimeDays,
    openCount: openItems.length,
    openByAssignee: Array.from(openByAssignee.values()).sort((a, b) => b.count - a.count),
  });
});

export default router;
