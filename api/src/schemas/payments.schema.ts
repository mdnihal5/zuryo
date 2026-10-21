import { z } from "zod";

// Shaped like a Cashfree payment webhook (type, event_time, data.order, data.payment), with amounts in paise.
export const webhookSchema = z
    .object({
        type: z.enum(["PAYMENT_SUCCESS_WEBHOOK", "PAYMENT_FAILED_WEBHOOK"]),
        event_time: z.iso.datetime({ offset: true }),
        data: z.object({
            order: z.object({
                order_id: z.string().min(1).max(100),
                order_amount_paise: z.number().int(),
                order_currency: z.string().max(10),
            }),
            payment: z.object({
                payment_id: z.string().min(1).max(100),
                payment_status: z.enum(["SUCCESS", "FAILED"]),
                payment_amount_paise: z.number().int(),
                payment_currency: z.string().max(10),
            }),
        }),
    })
    .refine((e) => (e.type === "PAYMENT_SUCCESS_WEBHOOK") === (e.data.payment.payment_status === "SUCCESS"), {
        message: "type and payment_status disagree",
    });
export type WebhookEvent = z.infer<typeof webhookSchema>;

const providerOrderId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const mockpayOrderParams = z.object({ providerOrderId });
export const mockpayCompleteSchema = z.object({ outcome: z.enum(["success", "failure"]) });
