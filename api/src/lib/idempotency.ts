import { createHash } from "node:crypto";
import { unprocessable } from "./http-error.js";

// Fingerprint of what the client asked for. Stored next to the Idempotency-Key so a reused key with a
// different request is caught instead of silently returning an unrelated result.
// Pass already-parsed values (dates as ISO strings) so equivalent requests hash the same.
export const requestHash = (request: Record<string, unknown>) =>
    createHash("sha256")
        .update(
            JSON.stringify(
                Object.keys(request)
                    .sort()
                    .map((k) => [k, request[k] ?? null]),
            ),
        )
        .digest("hex");

export function assertSameRequest(storedHash: string, hash: string) {
    if (storedHash !== hash) {
        throw unprocessable("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request.");
    }
}
