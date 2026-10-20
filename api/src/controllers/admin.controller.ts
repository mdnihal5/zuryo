import type { Request, Response } from "express";
import * as adminService from "../services/admin.service.js";
import * as pricingService from "../services/pricing.service.js";
import { send } from "../lib/http.js";
import type { IdParams } from "../schemas/common.schema.js";

export const listBookings = async (req: Request, res: Response) =>
    send(res, 200, await adminService.listBookings(req.valid.query));
export const getBooking = async (req: Request, res: Response) =>
    send(res, 200, await adminService.getBooking((req.valid.params as IdParams).id));
export const getPricing = async (_req: Request, res: Response) => send(res, 200, await pricingService.getRules());
export const updatePricing = async (req: Request, res: Response) =>
    send(res, 200, await pricingService.updateRules(req.user!.id, req.valid.body));
