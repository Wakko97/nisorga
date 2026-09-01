import { prisma } from "./prisma";
import { decrypt } from "./crypto";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  fromEmail: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
}

/**
 * Resolves mail configuration with the Owner-managed Settings (AppState,
 * see GET/PUT /settings/mail) taking priority over the matching env var,
 * falling back to it field-by-field. This lets a deployment configure mail
 * either entirely via env vars (e.g. a fresh install via
 * nisorga-app-install.sh, before anyone has logged in) or via the Settings
 * UI once an Owner exists — without needing an env-only or DB-only choice.
 */
async function getAppState() {
  return prisma.appState.findUnique({ where: { id: 1 } });
}

/** Returns null when SMTP isn't configured anywhere (env or Settings). */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const state = await getAppState();
  const host = state?.smtpHost || process.env.SMTP_HOST;
  if (!host) return null;

  return {
    host,
    port: state?.smtpPort ?? Number(process.env.SMTP_PORT || 587),
    secure: state?.smtpHost ? state.smtpSecure : process.env.SMTP_SECURE === "true",
    user: state?.smtpUser || process.env.SMTP_USER || undefined,
    password: state?.smtpPasswordEnc ? decrypt(state.smtpPasswordEnc) : process.env.SMTP_PASSWORD,
    fromEmail: state?.smtpFromEmail || process.env.SMTP_FROM_EMAIL || "noreply@example.com",
  };
}

/** Returns null when IMAP isn't configured anywhere (env or Settings). */
export async function getImapConfig(): Promise<ImapConfig | null> {
  const state = await getAppState();
  const host = state?.imapHost || process.env.IMAP_HOST;
  const user = state?.imapUser || process.env.IMAP_USER;
  const password = state?.imapPasswordEnc ? decrypt(state.imapPasswordEnc) : process.env.IMAP_PASSWORD;
  if (!host || !user || !password) return null;

  return {
    host,
    port: state?.imapPort ?? Number(process.env.IMAP_PORT || 993),
    secure: state?.imapHost ? state.imapSecure : process.env.IMAP_SECURE !== "false",
    user,
    password,
    mailbox: state?.imapMailbox || process.env.IMAP_MAILBOX || "INBOX",
  };
}

export async function getEmailInboundDomain(): Promise<string> {
  const state = await getAppState();
  return state?.emailInboundDomain || process.env.EMAIL_INBOUND_DOMAIN || "inbound.example.com";
}
