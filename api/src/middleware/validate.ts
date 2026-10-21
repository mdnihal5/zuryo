import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { HttpError } from "../lib/http-error.js";

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType; headers?: ZodType };

// Parses each part of the request before the controller runs. Controllers read req.valid, never req.body.
export const validate =
    (schemas: Schemas): RequestHandler =>
    (req, _res, next) => {
        req.valid = {};
        for (const part of ["body", "query", "params", "headers"] as const) {
            const schema = schemas[part];
            if (!schema) continue;
            const result = schema.safeParse(req[part]);
            if (!result.success) {
                const issues = result.error.issues.map((i) => ({
                    field: [part, ...i.path].join("."),
                    message: i.message,
                }));
                throw new HttpError(400, "VALIDATION_ERROR", "The request is not valid.", issues);
            }
            req.valid[part] = result.data;
        }
        next();
    };
