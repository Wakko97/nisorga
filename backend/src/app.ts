import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRouter from "./routes/auth";
import itemsRouter from "./routes/items";
import usersRouter from "./routes/users";
import googleIntegrationRouter from "./routes/googleIntegration";
import settingsRouter from "./routes/settings";
import apiV1Router from "./routes/apiV1";
import reviewRouter from "./routes/review";
import emailInboundRouter from "./routes/emailInbound";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

export const app = express();

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.use("/auth", authRouter);
app.use("/items", itemsRouter);
app.use("/users", usersRouter);
app.use("/integrations/google", googleIntegrationRouter);
app.use("/settings", settingsRouter);
app.use("/api/v1", apiV1Router);
app.use("/review", reviewRouter);
app.use("/integrations/email", emailInboundRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});
