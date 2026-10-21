import type { RequestHandler } from "express";
import { authenticate } from "../services/auth.service.js";
import { verifyToken } from "../lib/jwt.js";
import { HttpError } from "../lib/http-error.js";
import type { Role } from "../types/index.js";

export const requireAuth: RequestHandler = async (req, _res, next) => {
    const header = req.headers.authorization ?? "";
    const claims = header.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;
    const user = claims ? await authenticate(claims.sub, claims.tv) : null;
    if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
    req.user = user;
    next();
};

export const requireRole =
    (...roles: Role[]): RequestHandler =>
    (req, _res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            throw new HttpError(403, "FORBIDDEN", "You do not have access to this.");
        }
        next();
    };
