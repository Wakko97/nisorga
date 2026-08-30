import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { generateApiKey } from "../lib/apiKey";

const router = Router();
router.use(requireAuth);

// API keys
router.get("/api-keys", async (req, res) => {
  const keys = await prisma.apiKey.findMany({
    where: { userId: req.user!.id },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(keys);
});

router.post("/api-keys", async (req, res) => {
  const { label } = req.body ?? {};
  if (!label) return res.status(400).json({ error: "label is required" });

  const { plain, hash } = generateApiKey();
  const key = await prisma.apiKey.create({
    data: { userId: req.user!.id, key: hash, label },
  });
  // Plaintext key is returned only once; only the hash is persisted.
  res.status(201).json({ id: key.id, label: key.label, createdAt: key.createdAt, key: plain });
});

router.delete("/api-keys/:id", async (req, res) => {
  const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (!key || key.userId !== req.user!.id) return res.status(404).json({ error: "Not found" });
  await prisma.apiKey.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// Webhooks
router.get("/webhooks", async (req, res) => {
  const hooks = await prisma.webhookSubscription.findMany({ where: { userId: req.user!.id } });
  res.json(hooks);
});

router.post("/webhooks", async (req, res) => {
  const { url, events } = req.body ?? {};
  if (!url || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "url and non-empty events[] are required" });
  }
  const hook = await prisma.webhookSubscription.create({
    data: { userId: req.user!.id, url, events },
  });
  res.status(201).json(hook);
});

router.delete("/webhooks/:id", async (req, res) => {
  const hook = await prisma.webhookSubscription.findUnique({ where: { id: req.params.id } });
  if (!hook || hook.userId !== req.user!.id) return res.status(404).json({ error: "Not found" });
  await prisma.webhookSubscription.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
