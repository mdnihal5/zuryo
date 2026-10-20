import type { Request, Response } from "express";
import * as packagesService from "../services/packages.service.js";
import { send } from "../lib/http.js";

export const list = async (req: Request, res: Response) => send(res, 200, await packagesService.list(req.user!));
export const buy = async (req: Request, res: Response) =>
    send(res, 201, await packagesService.buy(req.user!, req.valid.body.sessions, req.valid.headers["idempotency-key"]));
