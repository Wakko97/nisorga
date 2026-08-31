/**
 * Fails fast at process startup if security-critical env vars are missing,
 * instead of limping along with an undefined secret (or a lazy throw deep
 * inside a request handler). Skipped in tests: tests import `app.ts`
 * directly (not `index.ts`), set their own dummy values in tests/setup.ts,
 * and never call this — the NODE_ENV guard is kept here anyway for
 * robustness in case that ever changes.
 */
export function assertRequiredEnv(): void {
  if (process.env.NODE_ENV === "test") return;

  const required = ["JWT_SECRET", "GOOGLE_TOKEN_ENCRYPTION_KEY"];
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
    process.exit(1);
  }
}
