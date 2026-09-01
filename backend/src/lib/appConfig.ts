import { prisma } from "./prisma";

/**
 * Resolves the delegation-reminder threshold with the Owner-managed
 * Settings (AppState, see GET/PUT /settings/app) taking priority over
 * WAITING_REMINDER_DAYS, same DB-first/env-fallback pattern as
 * lib/mailConfig.ts.
 */
export async function getWaitingReminderDays(): Promise<number> {
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  return state?.waitingReminderDays ?? Number(process.env.WAITING_REMINDER_DAYS || 3);
}
