import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "noreply@example.com";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

/**
 * Thin wrapper around @sendgrid/mail. No-ops with a console warning when no
 * API key is configured, so local development works without a SendGrid
 * account.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!SENDGRID_API_KEY) {
    console.warn(`[sendgrid] SENDGRID_API_KEY not set — skipping email to ${to}: "${subject}"`);
    return;
  }

  try {
    await sgMail.send({ to, from: SENDGRID_FROM_EMAIL, subject, html });
  } catch (err) {
    console.error(`[sendgrid] Failed to send email to ${to}:`, err);
  }
}
