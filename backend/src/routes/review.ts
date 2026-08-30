import { Router } from "express";
import { prisma, publicUserSelect } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { AuthUser } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

const IDEA_STALE_DAYS = 3;

function visibilityWhere(user: AuthUser) {
  if (user.role === "OWNER") return {};
  return {
    OR: [{ createdById: user.id }, { assignedToId: user.id }],
  };
}

/**
 * Shared weekly-review aggregation, reused by the /review/weekly route and
 * the weekly digest cron job.
 */
export async function getWeeklyReviewData(user: AuthUser) {
  const now = new Date();
  const ideaCutoff = new Date(now.getTime() - IDEA_STALE_DAYS * 24 * 60 * 60 * 1000);
  const where = visibilityWhere(user);

  const [openInboxItems, overdueTasks, staleIdeas] = await Promise.all([
    prisma.item.findMany({
      where: { ...where, status: "INBOX" },
      include: { createdBy: { select: publicUserSelect }, assignedTo: { select: publicUserSelect } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.item.findMany({
      where: { ...where, type: "TASK", status: { not: "DONE" }, dueDate: { lt: now } },
      include: { createdBy: { select: publicUserSelect }, assignedTo: { select: publicUserSelect } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.item.findMany({
      where: { ...where, type: "IDEA", status: "INBOX", createdAt: { lt: ideaCutoff } },
      include: { createdBy: { select: publicUserSelect }, assignedTo: { select: publicUserSelect } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return { openInboxItems, overdueTasks, staleIdeas };
}

router.get("/weekly", async (req, res) => {
  const data = await getWeeklyReviewData(req.user!);
  res.json(data);
});

export default router;
