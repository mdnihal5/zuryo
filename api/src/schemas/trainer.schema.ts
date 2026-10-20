import { z } from "zod";
import { isoDate, pageQuery, plainText } from "./common.schema.js";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour");

export const hoursSchema = z.object({
    hours: z
        .array(
            z
                .object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm })
                .refine((h) => h.start < h.end, "start must be before end"),
        )
        .max(7)
        .refine((hs) => new Set(hs.map((h) => h.weekday)).size === hs.length, "One window per weekday"),
});

export const timeOffSchema = z.object({
    startsAt: isoDate,
    endsAt: isoDate,
    reason: plainText(200).optional(),
});

const exercise = z.object({
    name: plainText(80).min(1),
    focus: z.enum(["upper", "lower", "core", "cardio", "mobility"]),
    sets: z.number().int().min(1).max(20).optional(),
    reps: z.number().int().min(1).max(200).optional(),
    minutes: z.number().int().min(1).max(120).optional(),
});

export const recordSchema = z.object({
    exercises: z.array(exercise).min(1).max(30),
    durationMinutes: z.number().int().min(1).max(240),
    trainerNotes: plainText(2000)
        .nullish()
        .transform((v) => v ?? null),
    suggestedNextWorkout: plainText(500)
        .nullish()
        .transform((v) => v ?? null),
});

export const sessionsQuery = z.object({ view: z.enum(["upcoming", "history"]).optional(), ...pageQuery });
