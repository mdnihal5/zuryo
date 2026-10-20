import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config/index.js";
import { pool } from "./db/pool.js";
import {
    authRoutes,
    customerRoutes,
    trainerRoutes,
    adminRoutes,
    notificationsRoutes,
    paymentsRoutes,
    mockpayRoutes,
} from "./routes/index.js";
import { requestContext } from "./middleware/request-context.js";
import { globalLimit } from "./middleware/rate-limit.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

app.use(requestContext);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })); // the browser client lives on another origin
app.use(
    cors({
        origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
        allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
        exposedHeaders: ["X-Request-Id"],
    }),
);

// Liveness (does not touch the database) and readiness (does).
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", async (_req, res) => {
    const ok = await pool.query("SELECT 1").then(
        () => true,
        () => false,
    );
    res.status(ok ? 200 : 503).json({ ok });
});

// Before express.json: the webhook needs the raw bytes to check the signature.
app.use("/v1/payments", paymentsRoutes);

app.use(globalLimit);
app.use(express.json({ limit: "100kb" }));

if (config.mockpayEnabled) app.use("/mockpay", mockpayRoutes);

app.use("/v1/auth", authRoutes);
app.use("/v1/notifications", notificationsRoutes);
app.use("/v1/trainer", trainerRoutes);
app.use("/v1/admin", adminRoutes);
app.use("/v1", customerRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
