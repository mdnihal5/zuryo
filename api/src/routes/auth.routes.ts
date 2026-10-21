import { Router } from "express";
import * as auth from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { loginLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { loginSchema } from "../schemas/auth.schema.js";

export const authRoutes = Router();
authRoutes.post("/login", loginLimit, validate({ body: loginSchema }), auth.login);
authRoutes.get("/me", requireAuth, auth.me);
authRoutes.post("/logout", requireAuth, auth.logout);
