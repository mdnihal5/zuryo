import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { log } from "../lib/logger.js";

// Gives every request an id (also returned as X-Request-Id) and writes one log line when it ends.
export const requestContext: RequestHandler = (req, res, next) => {
    req.id = randomUUID().slice(0, 8);
    res.setHeader("X-Request-Id", req.id);
    const started = process.hrtime.bigint();
    res.on("finish", () => {
        if (req.path === "/healthz") return;
        const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
        const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
        log[level]("http.request", {
            status: res.statusCode,
            method: req.method,
            path: req.originalUrl.split("?")[0],
            dur: `${ms}ms`,
            rid: req.id,
            uid: req.user?.id,
        });
    });
    next();
};
