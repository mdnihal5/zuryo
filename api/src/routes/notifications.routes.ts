import { Router } from "express";
import * as notifications from "../controllers/notifications.controller.js";
import { requireAuth } from "../middleware/auth.js";

// Any signed-in role sees only its own notifications.
export const notificationsRoutes = Router();
notificationsRoutes.use(requireAuth);
notificationsRoutes.get("/", notifications.list);
notificationsRoutes.post("/read", notifications.markAllRead);
