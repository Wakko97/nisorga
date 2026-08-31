export const RECURRENCE_RULES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type RecurrenceRule = (typeof RECURRENCE_RULES)[number];

/** Advances `from` by one occurrence of `rule`. */
export function nextOccurrence(rule: RecurrenceRule, from: Date): Date {
  const next = new Date(from);
  switch (rule) {
    case "DAILY":
      next.setDate(next.getDate() + 1);
      break;
    case "WEEKLY":
      next.setDate(next.getDate() + 7);
      break;
    case "MONTHLY":
      next.setMonth(next.getMonth() + 1);
      break;
  }
  return next;
}
