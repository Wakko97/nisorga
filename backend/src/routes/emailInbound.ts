import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * SendGrid Inbound Parse webhook.
 *
 * Address format: the inbound address is a "plus addressed" mailbox of the
 * form `inbox+<emailInboundToken>@<EMAIL_INBOUND_DOMAIN>`, e.g.
 * `inbox+3fa2c1e4-...-b2@inbound.nisorga.app`. We extract the token from the
 * local part between "+" and "@" and look up the owning user by it.
 *
 * Not protected by requireAuth (SendGrid calls this directly), but requires
 * a shared secret query param (?secret=...) matching EMAIL_INBOUND_SECRET.
 */
router.post("/inbound", upload.none(), async (req, res) => {
  const secret = process.env.EMAIL_INBOUND_SECRET;
  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({ error: "Invalid or missing secret" });
  }

  const to = String(req.body?.to ?? "");
  const subject = String(req.body?.subject ?? "(kein Betreff)");
  const text = req.body?.text ? String(req.body.text) : req.body?.html ? String(req.body.html) : "";

  const match = to.match(/\+([^@]+)@/);
  const token = match?.[1];
  if (!token) {
    return res.status(400).json({ error: "Could not extract inbound token from 'to' address" });
  }

  const user = await prisma.user.findUnique({ where: { emailInboundToken: token } });
  if (!user) {
    return res.status(404).json({ error: "No user found for inbound token" });
  }

  const item = await prisma.item.create({
    data: {
      title: subject,
      description: text || null,
      type: "IDEA",
      status: "INBOX",
      source: "EMAIL",
      createdById: user.id,
    },
  });

  res.status(201).json({ ok: true, itemId: item.id });
});

export default router;
