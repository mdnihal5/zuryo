import type { Request, Response } from "express";
import * as authService from "../services/auth.service.js";
import { send } from "../lib/http.js";
import type { LoginInput } from "../schemas/auth.schema.js";

export const login = async (req: Request, res: Response) => {
    const { email, password } = req.valid.body as LoginInput;
    send(res, 200, await authService.login(email, password));
};
export const me = async (req: Request, res: Response) => send(res, 200, await authService.me(req.user!.id));
export const logout = async (req: Request, res: Response) => {
    await authService.logoutEverywhere(req.user!.id);
    send(res, 200, { loggedOut: true });
};
