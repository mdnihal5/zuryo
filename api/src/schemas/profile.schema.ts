import { z } from "zod";
import { plainText } from "./common.schema.js";

const tag = plainText(40).min(1);

export const profileSchema = z
    .object({
        age: z.number().int().min(10).max(100),
        weightKg: z.number().min(20).max(300),
        goals: z.array(tag).min(1).max(6),
        level: z.enum(["beginner", "intermediate", "advanced"]),
        preferences: z.array(tag).max(10),
    })
    .transform(({ weightKg, ...rest }) => ({ ...rest, weight_kg: weightKg }));
