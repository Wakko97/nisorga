export const WAITING_OVERDUE_DAYS = 3;

export function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function isWaitingOverdue(status: string, waitingSince: string | null): boolean {
  if (status !== "WAITING" || !waitingSince) return false;
  return daysSince(waitingSince) >= WAITING_OVERDUE_DAYS;
}
