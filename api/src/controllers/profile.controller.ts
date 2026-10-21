import type { Request, Response } from "express";
import * as profileService from "../services/profile.service.js";
import * as recommendationService from "../services/recommendation.service.js";
import { send } from "../lib/http.js";

export const get = async (req: Request, res: Response) => send(res, 200, await profileService.get(req.user!));
export const save = async (req: Request, res: Response) =>
    send(res, 200, await profileService.save(req.user!, req.valid.body));
export const nextWorkout = async (req: Request, res: Response) =>
    send(res, 200, await recommendationService.nextWorkout(req.user!));
