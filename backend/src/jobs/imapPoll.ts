import { ImapFlow } from "imapflow";
import { simpleParser, AddressObject } from "mailparser";
import { createItemFromInboundEmail } from "../lib/inboundEmail";
import { getImapConfig } from "../lib/mailConfig";

function addressText(addr: AddressObject | AddressObject[] | undefined): string {
  if (!addr) return "";
  return Array.isArray(addr) ? addr.map((a) => a.text).join(", ") : addr.text;
}

/**
 * Polls an IMAP mailbox for unseen messages and turns each into an Item via
 * createItemFromInboundEmail, replacing the old SendGrid Inbound Parse
 * webhook. No-ops with a console warning when IMAP isn't configured, so
 * local development works without a mail account (same graceful
 * degradation as the mailer).
 *
 * Exported separately so it can be triggered manually / from tests without
 * going through node-cron.
 */
export async function runImapPoll(): Promise<{ processed: number }> {
  // Resolved fresh on every call (Settings UI, falling back to env vars) so
  // this reflects a config change made at runtime without needing a
  // process restart.
  const config = await getImapConfig();
  if (!config) {
    console.warn("[imap] IMAP not configured (Settings or IMAP_HOST/IMAP_USER/IMAP_PASSWORD) — skipping inbound mail poll");
    return { processed: 0 };
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  const IMAP_MAILBOX = config.mailbox;

  let processed = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock(IMAP_MAILBOX);
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids || []) {
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!msg || !msg.source) continue;

          const parsed = await simpleParser(msg.source);
          await createItemFromInboundEmail({
            to: addressText(parsed.to),
            subject: parsed.subject || "",
            text: parsed.text || (typeof parsed.html === "string" ? parsed.html : ""),
          });
          processed++;
        } catch (err) {
          console.error(`[imap] Failed to process message uid=${uid}:`, err);
        } finally {
          // Mark seen either way, so a permanently unroutable message
          // (unknown token, parse error) doesn't get reprocessed forever.
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return { processed };
}
