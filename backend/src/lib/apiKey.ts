import crypto from "crypto";

const PREFIX = "nis_";

export function generateApiKey(): { plain: string; hash: string } {
  const raw = crypto.randomBytes(24).toString("hex");
  const plain = `${PREFIX}${raw}`;
  const hash = hashApiKey(plain);
  return { plain, hash };
}

export function hashApiKey(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}
