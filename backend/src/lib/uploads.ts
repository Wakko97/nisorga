import fs from "fs";
import path from "path";
import crypto from "crypto";

// Uploaded item attachments (photos taken with the camera-scan feature)
// are stored on disk under this directory, never in the DB. Only the
// generated filename is stored on Item.attachmentPath — never anything
// derived from a client-supplied filename (path traversal risk).
export const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || "./uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const ALLOWED_ATTACHMENT_MIME_TYPES = Object.keys(MIME_TO_EXT);

export const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])
);

export class UnsupportedAttachmentTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported attachment type: ${mimeType}`);
    this.name = "UnsupportedAttachmentTypeError";
  }
}

/**
 * Saves an uploaded file buffer under a random, collision-safe filename
 * (never the client-supplied original filename) and returns the relative
 * path (just the filename) to store on Item.attachmentPath.
 */
export async function saveUpload(buffer: Buffer, originalMimeType: string): Promise<string> {
  const ext = MIME_TO_EXT[originalMimeType];
  if (!ext) {
    throw new UnsupportedAttachmentTypeError(originalMimeType);
  }
  const filename = `${crypto.randomUUID()}.${ext}`;
  const fullPath = path.join(UPLOADS_DIR, filename);
  await fs.promises.writeFile(fullPath, buffer);
  return filename;
}

/** Resolves a stored attachmentPath (a bare filename) to an absolute path on disk. */
export function resolveUploadPath(attachmentPath: string): string {
  // attachmentPath is always a filename we generated ourselves (no path
  // separators possible), but resolve + containment-check defensively.
  const resolved = path.resolve(UPLOADS_DIR, attachmentPath);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) && resolved !== UPLOADS_DIR) {
    throw new Error("Invalid attachment path");
  }
  return resolved;
}

export async function deleteUpload(attachmentPath: string): Promise<void> {
  const fullPath = resolveUploadPath(attachmentPath);
  try {
    await fs.promises.unlink(fullPath);
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}

export function mimeTypeForExt(attachmentPath: string): string {
  const ext = path.extname(attachmentPath).replace(".", "").toLowerCase();
  return EXT_TO_MIME[ext] || "application/octet-stream";
}
