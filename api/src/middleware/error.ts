import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import { log } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
    next(new HttpError(404, "ROUTE_NOT_FOUND", "No such endpoint."));
};

// One error shape for everything. Unexpected errors are logged in full and shown as a generic 500.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Something went wrong.";
    let details: unknown;

    if (err instanceof HttpError) {
        ({ status, code, message, details } = err);
    } else if (err?.type === "entity.parse.failed") {
        [status, code, message] = [400, "INVALID_JSON", "The request body is not valid JSON."];
    } else if (err?.type === "entity.too.large") {
        [status, code, message] = [413, "BODY_TOO_LARGE", "The request body is too large."];
    } else {
        log.error("http.unhandled", {
            rid: req.id,
            err: err?.name,
            code: err?.code,
            msg: err?.message,
            path: req.path,
        });
    }

    res.status(status).json({
        error: { code, message, requestId: req.id, ...(details !== undefined && { details }) },
        serverNow: new Date().toISOString(),
    });
};
