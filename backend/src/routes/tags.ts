import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// Tags are a shared, workspace-wide vocabulary (like GitHub labels) rather
// than per-user — any authenticated member can list/create them, matching
// how assignment and other shared metadata already work in this app.
router.get("/", async (_req, res) => {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
  res.json(tags);
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

router.post("/", async (req, res) => {
  const { name, color } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (color !== undefined && !HEX_COLOR.test(color)) {
    return res.status(400).json({ error: "color must be a hex color like #615ef2" });
  }

  try {
    const tag = await prisma.tag.create({
      data: { name: name.trim(), ...(color ? { color } : {}) },
    });
    res.status(201).json(tag);
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ error: "Tag already exists" });
    throw err;
  }
});

router.delete("/:id", async (req, res) => {
  await prisma.tag.delete({ where: { id: req.params.id } }).catch(() => null);
  res.json({ ok: true });
});

export default router;
