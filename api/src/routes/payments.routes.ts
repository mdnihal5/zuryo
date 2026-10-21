import express, { Router } from "express";
import * as payments from "../controllers/payments.controller.js";
import { verifiedWebhook } from "../middleware/webhook.js";
import { validate } from "../middleware/validate.js";
import { webhookSchema } from "../schemas/payments.schema.js";

// The gateway calls this, not a logged-in user: the signature is the credential. express.raw keeps the bytes
// the signature was computed over; this router is mounted before express.json for that reason.
export const paymentsRoutes = Router();
paymentsRoutes.post(
    "/webhook",
    express.raw({ type: "application/json", limit: "100kb" }),
    verifiedWebhook,
    validate({ body: webhookSchema }),
    payments.webhook,
);
