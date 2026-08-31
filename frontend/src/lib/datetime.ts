/**
 * Converts a stored ISO/UTC timestamp into the value a `<input type="datetime-local">`
 * expects, expressed in the browser's local timezone (not the raw UTC wall-clock).
 */
export function toDatetimeLocalValue(isoString: string): string {
  const date = new Date(isoString);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

/**
 * Converts a `<input type="datetime-local">` value (no timezone info, implicitly
 * local time) into an offset-bearing ISO string safe to send to the backend.
 */
export function fromDatetimeLocalValue(localValue: string): string {
  return new Date(localValue).toISOString();
}
