import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { UPLOADS_DIR } from "../src/lib/uploads";
import fs from "fs";
import path from "path";

// Smallest possible valid 1x1 transparent PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function registerAndLogin(email: string, name: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "password123", name });
  return res.headers["set-cookie"];
}

describe("item attachments", () => {
  let ownerCookie: string[];
  let memberCookie: string[];
  let itemId: string;

  beforeEach(async () => {
    ownerCookie = await registerAndLogin("owner@test.com", "Owner");
    memberCookie = await registerAndLogin("member@test.com", "Member");
    const created = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Notiz" });
    itemId = created.body.id;
  });

  it("uploads an image attachment for an own item", async () => {
    const res = await request(app)
      .post(`/items/${itemId}/attachment`)
      .set("Cookie", ownerCookie)
      .attach("file", PNG_1X1, { filename: "scan.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.attachmentPath).toBeTruthy();
    expect(fs.existsSync(path.join(UPLOADS_DIR, res.body.attachmentPath))).toBe(true);
  });

  it("rejects upload for another user's item", async () => {
    const res = await request(app)
      .post(`/items/${itemId}/attachment`)
      .set("Cookie", memberCookie)
      .attach("file", PNG_1X1, { filename: "scan.png", contentType: "image/png" });

    expect([403, 404]).toContain(res.status);
  });

  it("rejects non-image files", async () => {
    const res = await request(app)
      .post(`/items/${itemId}/attachment`)
      .set("Cookie", ownerCookie)
      .attach("file", Buffer.from("hello world"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
  });

  it("rejects files larger than 10MB", async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    const res = await request(app)
      .post(`/items/${itemId}/attachment`)
      .set("Cookie", ownerCookie)
      .attach("file", big, { filename: "big.png", contentType: "image/png" });

    expect(res.status).toBe(400);
  });

  it("serves the attachment only to authorized users", async () => {
    await request(app)
      .post(`/items/${itemId}/attachment`)
      .set("Cookie", ownerCookie)
      .attach("file", PNG_1X1, { filename: "scan.png", contentType: "image/png" });

    const ok = await request(app).get(`/items/${itemId}/attachment`).set("Cookie", ownerCookie);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("image/png");

    const forbidden = await request(app).get(`/items/${itemId}/attachment`).set("Cookie", memberCookie);
    expect([403, 404]).toContain(forbidden.status);
  });

  it("deletes the attachment and clears attachmentPath", async () => {
    const uploaded = await request(app)
      .post(`/items/${itemId}/attachment`)
      .set("Cookie", ownerCookie)
      .attach("file", PNG_1X1, { filename: "scan.png", contentType: "image/png" });

    const filePath = path.join(UPLOADS_DIR, uploaded.body.attachmentPath);
    expect(fs.existsSync(filePath)).toBe(true);

    const res = await request(app).delete(`/items/${itemId}/attachment`).set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.attachmentPath).toBeNull();
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
