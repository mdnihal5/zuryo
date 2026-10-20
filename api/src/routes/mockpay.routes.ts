import { Router } from "express";
import * as mockpay from "../controllers/mockpay.controller.js";
import { validate } from "../middleware/validate.js";
import { mockpayCompleteSchema, mockpayOrderParams } from "../schemas/payments.schema.js";

// Stands in for the gateway's own hosted checkout API. Like the real one it has no login: knowing the
// order id is the capability. Mounted only when MOCKPAY_ENABLED is true.
export const mockpayRoutes = Router();
mockpayRoutes.get("/orders/:providerOrderId", validate({ params: mockpayOrderParams }), mockpay.getOrder);
mockpayRoutes.post(
    "/orders/:providerOrderId/complete",
    validate({ params: mockpayOrderParams, body: mockpayCompleteSchema }),
    mockpay.complete,
);
