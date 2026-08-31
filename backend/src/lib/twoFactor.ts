import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const ISSUER = "Nisorga";
const BACKUP_CODE_COUNT = 10;
// One time-step (30s, the TOTP default) of tolerance each way, so a small
// clock drift between server and authenticator app doesn't lock people out.
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export async function generateTotpQrCodeDataUrl(email: string, secret: string): Promise<string> {
  const uri = generateURI({ issuer: ISSUER, label: email, secret });
  return QRCode.toDataURL(uri);
}

export async function verifyTotpToken(secret: string, token: string): Promise<boolean> {
  const result = await verify({ secret, token: String(token), epochTolerance: EPOCH_TOLERANCE_SECONDS });
  return result.valid;
}

/** Plaintext, human-typeable one-time backup codes (e.g. "a1b2c3d4e5"). */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString("hex"));
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
}

/**
 * Checks a submitted backup code against the stored hashes. On a match,
 * returns the remaining hashes with the used one removed (backup codes are
 * single-use) - the caller is responsible for persisting that back onto
 * the user, since this function has no DB access of its own.
 */
export async function consumeBackupCode(
  hashes: string[],
  code: string
): Promise<{ matched: boolean; remaining: string[] }> {
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(code, hashes[i])) {
      return { matched: true, remaining: [...hashes.slice(0, i), ...hashes.slice(i + 1)] };
    }
  }
  return { matched: false, remaining: hashes };
}
