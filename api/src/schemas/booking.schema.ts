import { z } from "zod";
import { idSchema, isoDate, pageQuery, plainText } from "./common.schema.js";

// Unknown keys (an "amount", a "price", a "role") are stripped, never read.
const optionalChoices = { preferredTrainerId: idSchema.optional(), packageId: idSchema.optional() };

export const createBookingSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("instant"), ...optionalChoices }),
    z.object({ mode: z.literal("scheduled"), startsAt: isoDate, ...optionalChoices }),
]);
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const rescheduleSchema = z.object({ startsAt: isoDate, preferredTrainerId: idSchema.optional() });
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

export const listBookingsQuery = z.object({
    view: z.enum(["upcoming", "history"]).optional(),
    ...pageQuery,
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuery>;

export const feedbackSchema = z.object({
    rating: z.number().int().min(1).max(5),
    comment: plainText(2000).optional(),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;

export const slotsQuery = z.object({
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a real date"),
});

export const quoteQuery = z.object({
    mode: z.enum(["instant", "scheduled"]),
    startsAt: isoDate.optional(),
});

export const adminListQuery = z.object({
    status: z
        .enum(["pending_payment", "confirmed", "in_progress", "completed", "cancelled", "payment_failed", "expired"])
        .optional(),
    mode: z.enum(["instant", "scheduled"]).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    trainerId: idSchema.optional(),
    customerId: idSchema.optional(),
    ...pageQuery,
});
