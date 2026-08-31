import { Router } from "express";
import { prisma, publicUserSelect } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { fireWebhooks } from "../lib/webhooks";
import { visibilityWhere, findItemForUser } from "../lib/itemAuthorization";
import { RECURRENCE_RULES, nextOccurrence } from "../lib/recurrence";
import { notifyMentionedUsers } from "../lib/mentions";

const router = Router();
router.use(requireAuth);

const VALID_TYPES = ["IDEA", "TASK"];
const VALID_STATUSES = ["INBOX", "TODO", "IN_PROGRESS", "WAITING", "DONE"];

function isValidRecurrenceRule(value: unknown): value is (typeof RECURRENCE_RULES)[number] | null {
  return value === null || RECURRENCE_RULES.includes(value as any);
}

const itemInclude = {
  createdBy: { select: publicUserSelect },
  assignedTo: { select: publicUserSelect },
  tags: { include: { tag: true } },
};

router.get("/", async (req, res) => {
  const user = req.user!;
  const { type, status, tagId } = req.query;

  if (type !== undefined && !VALID_TYPES.includes(String(type))) {
    return res.status(400).json({ error: "Invalid type" });
  }
  if (status !== undefined && !VALID_STATUSES.includes(String(status))) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const items = await prisma.item.findMany({
    where: {
      ...visibilityWhere(user),
      ...(type ? { type: String(type) as any } : {}),
      ...(status ? { status: String(status) as any } : {}),
      ...(tagId ? { tags: { some: { tagId: String(tagId) } } } : {}),
    },
    include: itemInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
});

router.post("/", async (req, res) => {
  const user = req.user!;
  const { title, description, type, status, important, urgent, dueDate, assignedToId, recurrenceRule } =
    req.body ?? {};
  if (!title) return res.status(400).json({ error: "title is required" });
  if (recurrenceRule !== undefined && !isValidRecurrenceRule(recurrenceRule)) {
    return res.status(400).json({ error: "Invalid recurrenceRule" });
  }

  const item = await prisma.item.create({
    data: {
      title,
      description: description ?? null,
      type: type ?? "IDEA",
      status: status ?? "INBOX",
      important: !!important,
      urgent: !!urgent,
      dueDate: dueDate ? new Date(dueDate) : null,
      waitingSince: status === "WAITING" ? new Date() : null,
      createdById: user.id,
      assignedToId: assignedToId ?? null,
      recurrenceRule: recurrenceRule ?? null,
    },
  });

  fireWebhooks(user.id, "item.created", item);
  res.status(201).json(item);
});

const MAX_BULK_IDS = 200;

router.patch("/bulk", async (req, res) => {
  const user = req.user!;
  const { ids, patch } = req.body ?? {};

  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK_IDS) {
    return res.status(400).json({ error: `ids must be a non-empty array of at most ${MAX_BULK_IDS} items` });
  }
  if (!patch || typeof patch !== "object") {
    return res.status(400).json({ error: "patch is required" });
  }

  const { status, assignedToId, important, urgent } = patch;
  if (status !== undefined && !VALID_STATUSES.includes(String(status))) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const skipped: { id: string; reason: "not_found" | "forbidden" }[] = [];
  const authorizedIds: string[] = [];

  for (const id of ids) {
    const existing = await findItemForUser(String(id), user);
    if (existing === null) skipped.push({ id, reason: "not_found" });
    else if (existing === "forbidden") skipped.push({ id, reason: "forbidden" });
    else authorizedIds.push(id);
  }

  let waitingSinceUpdate: { waitingSince: Date | null } | {} = {};
  if (status !== undefined) {
    waitingSinceUpdate = status === "WAITING" ? { waitingSince: new Date() } : { waitingSince: null };
  }

  const data = {
    ...(status !== undefined ? { status } : {}),
    ...(assignedToId !== undefined ? { assignedToId } : {}),
    ...(important !== undefined ? { important } : {}),
    ...(urgent !== undefined ? { urgent } : {}),
    ...waitingSinceUpdate,
  };

  const updated = authorizedIds.length
    ? await prisma.$transaction(
        authorizedIds.map((id) => prisma.item.update({ where: { id }, data }))
      )
    : [];

  for (const item of updated) {
    fireWebhooks(user.id, "item.updated", item);
  }

  res.json({ updated, skipped });
});

router.delete("/bulk", async (req, res) => {
  const user = req.user!;
  const { ids } = req.body ?? {};

  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK_IDS) {
    return res.status(400).json({ error: `ids must be a non-empty array of at most ${MAX_BULK_IDS} items` });
  }

  const skipped: { id: string; reason: "not_found" | "forbidden" }[] = [];
  const authorizedIds: string[] = [];

  for (const id of ids) {
    const existing = await findItemForUser(String(id), user);
    if (existing === null) skipped.push({ id, reason: "not_found" });
    else if (existing === "forbidden") skipped.push({ id, reason: "forbidden" });
    else authorizedIds.push(id);
  }

  if (authorizedIds.length) {
    await prisma.$transaction(authorizedIds.map((id) => prisma.item.delete({ where: { id } })));
  }

  res.json({ deletedIds: authorizedIds, skipped });
});

router.patch("/:id", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });

  const { title, description, type, status, important, urgent, dueDate, assignedToId, recurrenceRule } =
    req.body ?? {};
  if (recurrenceRule !== undefined && !isValidRecurrenceRule(recurrenceRule)) {
    return res.status(400).json({ error: "Invalid recurrenceRule" });
  }

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
      ...(recurrenceRule !== undefined ? { recurrenceRule } : {}),
      ...waitingSinceUpdate,
    },
  });

  // A recurring task that just got marked DONE spawns its next occurrence
  // immediately (rather than via a separate cron pass) so the user sees it
  // right away; only fires on the INTO-DONE transition, not e.g. re-saving
  // an already-done recurring task.
  if (
    status === "DONE" &&
    existing.status !== "DONE" &&
    item.type === "TASK" &&
    item.recurrenceRule &&
    RECURRENCE_RULES.includes(item.recurrenceRule as any)
  ) {
    const base = item.dueDate ?? new Date();
    await prisma.item.create({
      data: {
        title: item.title,
        description: item.description,
        type: "TASK",
        status: "TODO",
        important: item.important,
        urgent: item.urgent,
        dueDate: nextOccurrence(item.recurrenceRule as any, base),
        createdById: item.createdById,
        assignedToId: item.assignedToId,
        recurrenceRule: item.recurrenceRule,
      },
    });
  }

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

  notifyMentionedUsers({
    body,
    itemId: req.params.id,
    itemTitle: existing.title,
    authorId: user.id,
    authorName: user.name,
  });

  res.status(201).json(comment);
});

// Tags
router.post("/:id/tags", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });

  const { tagId } = req.body ?? {};
  if (!tagId) return res.status(400).json({ error: "tagId is required" });

  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) return res.status(404).json({ error: "Tag not found" });

  await prisma.itemTag.upsert({
    where: { itemId_tagId: { itemId: req.params.id, tagId } },
    create: { itemId: req.params.id, tagId },
    update: {},
  });

  const item = await prisma.item.findUnique({ where: { id: req.params.id }, include: itemInclude });
  res.status(201).json(item);
});

router.delete("/:id/tags/:tagId", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });

  await prisma.itemTag
    .delete({ where: { itemId_tagId: { itemId: req.params.id, tagId: req.params.tagId } } })
    .catch(() => null);

  const item = await prisma.item.findUnique({ where: { id: req.params.id }, include: itemInclude });
  res.json(item);
});

export default router;
