import { z } from "zod";

export const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;
