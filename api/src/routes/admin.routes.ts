import { Router } from "express";
import * as admin from "../controllers/admin.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParams } from "../schemas/common.schema.js";
import { adminListQuery } from "../schemas/booking.schema.js";
import { pricingRulesSchema } from "../schemas/pricing.schema.js";

export const adminRoutes = Router();
adminRoutes.use(requireAuth, requireRole("admin"));

adminRoutes.get("/bookings", validate({ query: adminListQuery }), admin.listBookings);
adminRoutes.get("/bookings/:id", validate({ params: idParams }), admin.getBooking);
adminRoutes.get("/pricing-rules", admin.getPricing);
adminRoutes.put("/pricing-rules", validate({ body: pricingRulesSchema }), admin.updatePricing);
