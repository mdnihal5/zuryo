import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour");
const paise = z.number().int().min(100).max(10_000_000);

export const pricingRulesSchema = z.object({
    normalPricePaise: paise,
    peakPricePaise: paise,
    commissionBps: z.number().int().min(0).max(5000),
    peakWindows: z
        .array(z.object({ start: hhmm, end: hhmm }).refine((w) => w.start < w.end, "start must be before end"))
        .max(6),
});
