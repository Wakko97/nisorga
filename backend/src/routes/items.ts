import { Router } from "express";
import { prisma, publicUserSelect } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { fireWebhooks } from "../lib/webhooks";

const router = Router();
router.use(requireAuth);

function visibilityWhere(user: NonNullable<Express.Request["user"]>) {
  if (user.role === "OWNER") return {};
  return {
    OR: [{ createdById: user.id }, { assignedToId: user.id }],
  };
}

router.get("/", async (req, res) => {
  const user = req.user!;
  const { type, status } = req.query;

  const items = await prisma.item.findMany({
    where: {
      ...visibilityWhere(user),
      ...(type ? { type: String(type) as any } : {}),
      ...(status ? { status: String(status) as any } : {}),
    },
    include: { createdBy: { select: publicUserSelect }, assignedTo: { select: publicUserSelect } },
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
});

router.post("/", async (req, res) => {
  const user = req.user!;
  const { title, description, type, status, important, urgent, dueDate, assignedToId } = req.body ?? {};
  if (!title) return res.status(400).json({ error: "title is required" });

  const item = await prisma.item.create({
    data: {
      title,
      description: description ?? null,
      type: type ?? "IDEA",
      status: status ?? "INBOX",
      important: !!important,
      urgent: !!urgent,
      dueDate: dueDate ? new Date(dueDate) : null,
      createdById: user.id,
      assignedToId: assignedToId ?? null,
    },
  });

  fireWebhooks(user.id, "item.created", item);
  res.status(201).json(item);
});

async function findItemForUser(id: string, user: NonNullable<Express.Request["user"]>) {
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return null;
  if (user.role === "OWNER") return item;
  if (item.createdById === user.id || item.assignedToId === user.id) return item;
  return "forbidden" as const;
}

router.patch("/:id", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });

  const { title, description, type, status, important, urgent, dueDate, assignedToId } = req.body ?? {};

  // Track when an item enters/leaves the WAITING (delegated, awaiting reply) state.
  let waitingSinceUpdate: { waitingSince: Date | null } | {} = {};
  if (status !== undefined) {
    waitingSinceUpdate = status === "WAITING" ? { waitingSince: new Date() } : { waitingSince: null };
  }

  const item = await prisma.item.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(important !== undefined ? { important } : {}),
      ...(urgent !== undefined ? { urgent } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      ...(assignedToId !== undefined ? { assignedToId } : {}),
      ...waitingSinceUpdate,
    },
  });

  fireWebhooks(user.id, "item.updated", item);
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });

  await prisma.item.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.post("/:id/convert", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });
  if (existing.type !== "IDEA") return res.status(400).json({ error: "Only ideas can be converted" });

  const item = await prisma.item.update({
    where: { id: req.params.id },
    data: { type: "TASK", status: existing.status === "INBOX" ? "TODO" : existing.status },
  });

  fireWebhooks(user.id, "item.updated", item);
  res.json(item);
});

// Comments
router.get("/:id/comments", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });

  const comments = await prisma.comment.findMany({
    where: { itemId: req.params.id },
    include: { author: { select: publicUserSelect } },
    orderBy: { createdAt: "asc" },
  });
  res.json(comments);
});

router.post("/:id/comments", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });

  const { body } = req.body ?? {};
  if (!body) return res.status(400).json({ error: "body is required" });

  const comment = await prisma.comment.create({
    data: { itemId: req.params.id, authorId: user.id, body },
    include: { author: { select: publicUserSelect } },
  });
  res.status(201).json(comment);
});

export default router;
