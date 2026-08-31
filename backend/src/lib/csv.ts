/**
 * Minimal CSV serializer (RFC 4180-ish): quotes a field only when it
 * contains a comma, quote, or newline, doubling any embedded quotes.
 * Deliberately not a dependency for this one call site (item export).
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsvField(row[col])).join(","));
  }
  // CRLF is the RFC 4180 line ending and what Excel expects.
  return lines.join("\r\n") + "\r\n";
}
