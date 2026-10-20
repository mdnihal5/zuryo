import { z } from "zod";
import { PAGE_MAX } from "../config/constants.js";
import { decodeCursor } from "../lib/cursor.js";

// 2147483647 is the largest Postgres int; anything bigger would be a database error instead of a 404.
export const idSchema = z.coerce.number().int().positive().max(2_147_483_647);

// Postgres text cannot hold a NUL character; reject it here instead of failing with a 500 later.
export const plainText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .regex(/^[^\0]*$/, "Must not contain NUL characters");
export const idParams = z.object({ id: idSchema });
export type IdParams = z.infer<typeof idParams>;

export const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const pageQuery = {
    limit: z.coerce.number().int().min(1).max(PAGE_MAX).optional(),
    cursor: z
        .string()
        .max(200)
        .optional()
        .transform((raw, ctx) => {
            if (raw === undefined) return null;
            const c = decodeCursor(raw);
            if (!c) ctx.addIssue({ code: "custom", message: "Invalid cursor" });
            return c;
        }),
};

// Writes that create something need a client-held key so a retry cannot create it twice.
export const idempotencyHeaders = z.object({
    "idempotency-key": z
        .string()
        .regex(/^[A-Za-z0-9_-]{8,100}$/, "Idempotency-Key must be 8-100 characters: letters, digits, - or _"),
});
