import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { findItemForUser } from "../lib/itemAuthorization";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  UnsupportedAttachmentTypeError,
  saveUpload,
  deleteUpload,
  resolveUploadPath,
  mimeTypeForExt,
} from "../lib/uploads";

const router = Router();
router.use(requireAuth);

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

function handleUpload(req: any, res: any, next: any) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large (max 10MB)" });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return next(err);
    next();
  });
}

router.post("/:id/attachment", handleUpload, async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });

  const file = req.file;
  if (!file) return res.status(400).json({ error: "file is required" });

  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimetype)) {
    return res.status(400).json({ error: "Unsupported file type. Allowed: JPEG, PNG, WebP" });
  }

  let attachmentPath: string;
  try {
    attachmentPath = await saveUpload(file.buffer, file.mimetype);
  } catch (err) {
    if (err instanceof UnsupportedAttachmentTypeError) {
      return res.status(400).json({ error: "Unsupported file type. Allowed: JPEG, PNG, WebP" });
    }
    throw err;
  }

  // Replace any previous attachment on disk to avoid orphaned files.
  if (existing.attachmentPath) {
    await deleteUpload(existing.attachmentPath);
  }

  const item = await prisma.item.update({
    where: { id: req.params.id },
    data: { attachmentPath },
  });

  res.json(item);
});

router.get("/:id/attachment", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });
  if (!existing.attachmentPath) return res.status(404).json({ error: "No attachment" });

  const fullPath = resolveUploadPath(existing.attachmentPath);
  res.setHeader("Content-Type", mimeTypeForExt(existing.attachmentPath));
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "Attachment file missing" });
    }
  });
});

router.delete("/:id/attachment", async (req, res) => {
  const user = req.user!;
  const existing = await findItemForUser(req.params.id, user);
  if (existing === null) return res.status(404).json({ error: "Not found" });
  if (existing === "forbidden") return res.status(403).json({ error: "Forbidden" });
  if (!existing.attachmentPath) return res.status(404).json({ error: "No attachment" });

  await deleteUpload(existing.attachmentPath);

  const item = await prisma.item.update({
    where: { id: req.params.id },
    data: { attachmentPath: null },
  });

  res.json(item);
});

export default router;
