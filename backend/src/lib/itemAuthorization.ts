import { prisma } from "./prisma";
import { AuthUser } from "../middleware/auth";

/** Owner sees everything; everyone else only items they created or are assigned. */
export function visibilityWhere(user: AuthUser) {
  if (user.role === "OWNER") return {};
  return {
    OR: [{ createdById: user.id }, { assignedToId: user.id }],
  };
}

/**
 * Loads an item and checks whether `user` may see it.
 * Returns the item, `null` if it doesn't exist, or `"forbidden"` if it
 * exists but the user isn't the owner/creator/assignee.
 */
export async function findItemForUser(id: string, user: AuthUser) {
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return null;
  if (user.role === "OWNER") return item;
  if (item.createdById === user.id || item.assignedToId === user.id) return item;
  return "forbidden" as const;
}
