import { z } from "zod";

export const PACKAGE_SIZES = [5, 10, 20] as const;
export const buyPackageSchema = z.object({
    sessions: z
        .number()
        .refine(
            (n) => (PACKAGE_SIZES as readonly number[]).includes(n),
            `sessions must be one of ${PACKAGE_SIZES.join(", ")}`,
        ),
});
