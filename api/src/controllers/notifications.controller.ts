import type { Request, Response } from "express";
import * as notificationsService from "../services/notifications.service.js";
import { send } from "../lib/http.js";

export const list = async (req: Request, res: Response) =>
    send(res, 200, await notificationsService.list(req.user!.id));
export const markAllRead = async (req: Request, res: Response) => {
    await notificationsService.markAllRead(req.user!.id);
    send(res, 200, { ok: true });
};
