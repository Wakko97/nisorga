import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { requireApiKey } from "../middleware/apiKeyAuth";
import { fireWebhooks } from "../lib/webhooks";

const router = Router();

// Keyed by the caller's API key (falling back to IP for unauthenticated/
// malformed requests) so one integration can't exhaust another's quota.
const apiV1RateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) return `key:${header.slice("Bearer ".length).trim()}`;
    return req.ip ?? "unknown";
  },
  message: { error: "Too many requests, please slow down." },
});

router.use(apiV1RateLimit);
router.use(requireApiKey);

router.get("/items", async (req, res) => {
  const user = req.user!;
  const items = await prisma.item.findMany({
    where: user.role === "OWNER" ? {} : { OR: [{ createdById: user.id }, { assignedToId: user.id }] },
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
});

router.post("/items", async (req, res) => {
  const user = req.user!;
  const { title, description, type, status, important, urgent, dueDate } = req.body ?? {};
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
    },
  });

  fireWebhooks(user.id, "item.created", item);
  res.status(201).json(item);
});

export default router;
