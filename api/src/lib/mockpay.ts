import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-mockpay-signature";

// HMAC-SHA256 over the exact bytes of the request body, hex encoded. The receiver must hash the raw bytes,
// not a re-serialised JSON object: re-serialising can change spacing or key order and break the match.
export const sign = (rawBody: Buffer | string, secret: string) =>
    createHmac("sha256", secret).update(rawBody).digest("hex");

export function verifySignature(rawBody: Buffer, signature: string | undefined, secret: string) {
    if (!signature) return false;
    const expected = Buffer.from(sign(rawBody, secret), "hex");
    const given = Buffer.from(signature, "hex");
    // timingSafeEqual throws on different lengths, and comparing in constant time stops a timing guess of the signature.
    return given.length === expected.length && timingSafeEqual(given, expected);
}
