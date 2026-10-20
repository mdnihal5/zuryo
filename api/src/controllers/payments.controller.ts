import type { Request, Response } from "express";
import * as paymentsService from "../services/payments.service.js";
import { send } from "../lib/http.js";
import type { WebhookEvent } from "../schemas/payments.schema.js";

export const webhook = async (req: Request, res: Response) =>
    send(res, 200, await paymentsService.handleWebhook(req.valid.body as WebhookEvent));
