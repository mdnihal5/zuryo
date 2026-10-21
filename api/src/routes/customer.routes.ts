import { Router } from "express";
import * as bookings from "../controllers/bookings.controller.js";
import * as packages from "../controllers/packages.controller.js";
import * as profile from "../controllers/profile.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recommendationLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { idParams, idempotencyHeaders } from "../schemas/common.schema.js";
import {
    createBookingSchema,
    feedbackSchema,
    listBookingsQuery,
    quoteQuery,
    rescheduleSchema,
    slotsQuery,
} from "../schemas/booking.schema.js";
import { buyPackageSchema } from "../schemas/package.schema.js";
import { profileSchema } from "../schemas/profile.schema.js";

// Everything here is customer-only. Ownership is enforced again in each query (WHERE customer_id = token user).
export const customerRoutes = Router();
customerRoutes.use(requireAuth, requireRole("customer"));

customerRoutes.get("/trainers", bookings.trainers);
customerRoutes.get("/slots", validate({ query: slotsQuery }), bookings.slots);
customerRoutes.get("/quote", validate({ query: quoteQuery }), bookings.quote);

customerRoutes.post("/bookings", validate({ headers: idempotencyHeaders, body: createBookingSchema }), bookings.create);
customerRoutes.get("/bookings", validate({ query: listBookingsQuery }), bookings.list);
customerRoutes.get("/bookings/:id", validate({ params: idParams }), bookings.get);
customerRoutes.post("/bookings/:id/cancel", validate({ params: idParams }), bookings.cancel);
customerRoutes.post(
    "/bookings/:id/reschedule",
    validate({ params: idParams, headers: idempotencyHeaders, body: rescheduleSchema }),
    bookings.reschedule,
);
customerRoutes.get("/bookings/:id/record", validate({ params: idParams }), bookings.getRecord);
customerRoutes.put("/bookings/:id/feedback", validate({ params: idParams, body: feedbackSchema }), bookings.feedback);

customerRoutes.get("/packages", packages.list);
customerRoutes.post("/packages", validate({ headers: idempotencyHeaders, body: buyPackageSchema }), packages.buy);

customerRoutes.get("/profile", profile.get);
customerRoutes.put("/profile", validate({ body: profileSchema }), profile.save);
customerRoutes.get("/recommendations/next-workout", recommendationLimit, profile.nextWorkout);
