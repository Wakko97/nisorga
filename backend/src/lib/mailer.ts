import nodemailer from "nodemailer";
import { getSmtpConfig } from "./mailConfig";

/**
 * Thin wrapper around nodemailer/SMTP, configured via getSmtpConfig()
 * (Settings UI, falling back to env vars). No-ops with a console warning
 * when nothing is configured, so local development works without a mail
 * account. A fresh transporter is created per call rather than cached,
 * since the config can change at runtime via the Settings UI.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const config = await getSmtpConfig();
  if (!config) {
    console.warn(`[mailer] SMTP not configured — skipping email to ${to}: "${subject}"`);
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    });
    await transporter.sendMail({ to, from: config.fromEmail, subject, html });
  } catch (err) {
    console.error(`[mailer] Failed to send email to ${to}:`, err);
  }
}
