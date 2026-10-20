import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { RequestHandler } from "express";
import { config } from "../config/index.js";

const passThrough: RequestHandler = (_req, _res, next) => next();

const limiter = (windowMs: number, limit: number, key?: (ip: string, req: Parameters<RequestHandler>[0]) => string) =>
    config.rateLimitEnabled
        ? rateLimit({
              windowMs,
              limit,
              standardHeaders: "draft-7",
              legacyHeaders: false,
              keyGenerator: (req) => key?.(ipKeyGenerator(req.ip ?? ""), req) ?? ipKeyGenerator(req.ip ?? ""),
              handler: (req, res) => {
                  res.status(429).json({
                      error: {
                          code: "RATE_LIMITED",
                          message: "Too many requests. Try again shortly.",
                          requestId: req.id,
                      },
                      serverNow: new Date().toISOString(),
                  });
              },
          })
        : passThrough;

export const globalLimit = limiter(60_000, 300);
// Keyed by IP and submitted email, so one attacker cannot spray one password across many accounts
// and one account cannot be hammered from many addresses unnoticed.
export const loginLimit = limiter(15 * 60_000, 10, (ip, req) => `${ip}|${String(req.body?.email ?? "").toLowerCase()}`);
// Each call may cost money (LLM), so it gets its own tight limit.
export const recommendationLimit = limiter(60_000, 6);
