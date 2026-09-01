import { prisma } from "./prisma";
import { fireWebhooks } from "./webhooks";

export interface InboundMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Turns a parsed inbound email into an Item.
 *
 * Address format: the inbound address is a "plus addressed" mailbox of the
 * form `inbox+<emailInboundToken>@<EMAIL_INBOUND_DOMAIN>`, e.g.
 * `inbox+3fa2c1e4-...-b2@inbound.nisorga.app`. We extract the token from the
 * local part between "+" and "@" and look up the owning user by it.
 *
 * Shared between the IMAP poller and its tests; returns null (rather than
 * throwing) for a message that can't be routed - no token in the address,
 * or no user owns that token - so the caller decides how to handle it (the
 * IMAP poller still marks such messages as read, so they aren't
 * reprocessed forever).
 */
export async function createItemFromInboundEmail(message: InboundMessage) {
  const match = message.to.match(/\+([^@]+)@/);
  const token = match?.[1];
  if (!token) return null;

  const user = await prisma.user.findUnique({ where: { emailInboundToken: token } });
  if (!user) return null;

  const item = await prisma.item.create({
    data: {
      title: message.subject || "(kein Betreff)",
      description: message.text || null,
      type: "IDEA",
      status: "INBOX",
      source: "EMAIL",
      createdById: user.id,
    },
  });

  fireWebhooks(user.id, "item.created", item);
  return item;
}
