// Must be imported before any router: it monkey-patches Express route
// handlers so a rejected promise from an async handler is forwarded to
// next(err) automatically instead of crashing the process / hanging the
// request.
import "express-async-errors";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import authRouter from "./routes/auth";
import itemsRouter from "./routes/items";
import attachmentsRouter from "./routes/attachments";
import usersRouter from "./routes/users";
import googleIntegrationRouter from "./routes/googleIntegration";
import settingsRouter from "./routes/settings";
import apiV1Router from "./routes/apiV1";
import reviewRouter from "./routes/review";
import dashboardRouter from "./routes/dashboard";
import emailInboundRouter from "./routes/emailInbound";
import setupRouter from "./routes/setup";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

export const app = express();

// Needed so express-rate-limit sees the real client IP (and so `secure`
// cookies work correctly) when running behind a reverse proxy (e.g. Nginx
// Proxy Manager) that terminates TLS.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);

// Default config only — CSP is intentionally not configured here since the
// frontend is served by a separate static host that sets its own CSP.
app.use(helmet());

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.use("/auth", authRouter);
app.use("/items", itemsRouter);
app.use("/items", attachmentsRouter);
app.use("/users", usersRouter);
app.use("/integrations/google", googleIntegrationRouter);
app.use("/settings", settingsRouter);
app.use("/api/v1", apiV1Router);
app.use("/review", reviewRouter);
app.use("/dashboard", dashboardRouter);
app.use("/integrations/email", emailInboundRouter);
app.use("/setup", setupRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Catches errors forwarded via next(err) — including unhandled rejections
// from async route handlers, thanks to express-async-errors above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
