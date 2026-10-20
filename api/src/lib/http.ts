import type { Response } from "express";

// Every JSON body carries serverNow, so clients can correct for their own clock being off.
export const send = (res: Response, status: number, data: unknown) =>
    res.status(status).json({ data, serverNow: new Date().toISOString() });
