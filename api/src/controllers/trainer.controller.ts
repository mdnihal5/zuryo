import type { Request, Response } from "express";
import * as trainerService from "../services/trainer.service.js";
import * as sessionsService from "../services/sessions.service.js";
import { send } from "../lib/http.js";
import type { IdParams } from "../schemas/common.schema.js";

const id = (req: Request) => (req.valid.params as IdParams).id;

export const listSessions = async (req: Request, res: Response) =>
    send(res, 200, await trainerService.listSessions(req.user!, req.valid.query));
export const getSession = async (req: Request, res: Response) =>
    send(res, 200, await trainerService.getSession(req.user!, id(req)));
export const start = async (req: Request, res: Response) =>
    send(res, 200, await sessionsService.startSession(req.user!, id(req)));
export const saveRecord = async (req: Request, res: Response) =>
    send(res, 200, await sessionsService.saveTrainerRecord(req.user!, id(req), req.valid.body));
export const getRecord = async (req: Request, res: Response) =>
    send(res, 200, await sessionsService.getRecord(req.user!, id(req)));

export const getAvailability = async (req: Request, res: Response) =>
    send(res, 200, await trainerService.getAvailability(req.user!));
export const setHours = async (req: Request, res: Response) =>
    send(res, 200, await trainerService.setHours(req.user!, req.valid.body.hours));
export const addTimeOff = async (req: Request, res: Response) => {
    const { startsAt, endsAt, reason } = req.valid.body;
    send(res, 201, await trainerService.addTimeOff(req.user!, startsAt, endsAt, reason ?? null));
};
export const removeTimeOff = async (req: Request, res: Response) => {
    await trainerService.removeTimeOff(req.user!, id(req));
    send(res, 200, { removed: true });
};
