import type { RequestHandler } from "express";
import { config } from "../config/index.js";
import { HttpError } from "../lib/http-error.js";
import { SIGNATURE_HEADER, verifySignature } from "../lib/mockpay.js";
import { log } from "../lib/logger.js";

// Runs after express.raw(), so req.body is the untouched bytes the gateway signed. Nothing in the body
// is looked at until the signature has been checked.
export const verifiedWebhook: RequestHandler = (req, _res, next) => {
    const raw: unknown = req.body;
    if (!Buffer.isBuffer(raw) || !verifySignature(raw, req.get(SIGNATURE_HEADER), config.webhookSecret)) {
        log.warn("payment.webhook_bad_signature", { rid: req.id });
        throw new HttpError(401, "INVALID_SIGNATURE", "The webhook signature is missing or wrong.");
    }
    try {
        req.body = JSON.parse(raw.toString("utf8"));
    } catch {
        throw new HttpError(400, "INVALID_JSON", "The request body is not valid JSON.");
    }
    next();
};
