import type { Request, Response } from "express";
import * as mockpayService from "../services/mockpay.service.js";
import { send } from "../lib/http.js";

export const getOrder = async (req: Request, res: Response) =>
    send(res, 200, await mockpayService.getOrder(req.valid.params.providerOrderId));

export const complete = async (req: Request, res: Response) =>
    send(res, 200, await mockpayService.complete(req.valid.params.providerOrderId, req.valid.body.outcome));
