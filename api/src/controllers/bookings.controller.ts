import type { Request, Response } from "express";
import * as bookingsService from "../services/bookings.service.js";
import * as sessionsService from "../services/sessions.service.js";
import * as slotsService from "../services/slots.service.js";
import { send } from "../lib/http.js";
import type { IdParams } from "../schemas/common.schema.js";
import type {
    CreateBookingInput,
    FeedbackInput,
    ListBookingsQuery,
    RescheduleInput,
} from "../schemas/booking.schema.js";

const key = (req: Request) => req.valid.headers["idempotency-key"] as string;

export const trainers = async (req: Request, res: Response) =>
    send(res, 200, await slotsService.listTrainers(req.user!));
export const slots = async (req: Request, res: Response) =>
    send(res, 200, await slotsService.listSlots(req.user!, req.valid.query.date));
export const quote = async (req: Request, res: Response) =>
    send(res, 200, await slotsService.quote(req.valid.query.mode, req.valid.query.startsAt));

// 201 for the first success and for a replay of it: the client cannot tell them apart, which is the point.
export const create = async (req: Request, res: Response) =>
    send(res, 201, await bookingsService.createBooking(req.user!, req.valid.body as CreateBookingInput, key(req)));

export const list = async (req: Request, res: Response) =>
    send(res, 200, await bookingsService.listMine(req.user!, req.valid.query as ListBookingsQuery));

export const get = async (req: Request, res: Response) =>
    send(res, 200, await bookingsService.getMine(req.user!, (req.valid.params as IdParams).id));

export const cancel = async (req: Request, res: Response) =>
    send(res, 200, await bookingsService.cancelBooking(req.user!, (req.valid.params as IdParams).id));

export const reschedule = async (req: Request, res: Response) =>
    send(
        res,
        201,
        await bookingsService.rescheduleBooking(
            req.user!,
            (req.valid.params as IdParams).id,
            req.valid.body as RescheduleInput,
            key(req),
        ),
    );

export const getRecord = async (req: Request, res: Response) =>
    send(res, 200, await sessionsService.getRecord(req.user!, (req.valid.params as IdParams).id));

export const feedback = async (req: Request, res: Response) =>
    send(
        res,
        200,
        await sessionsService.saveCustomerFeedback(
            req.user!,
            (req.valid.params as IdParams).id,
            req.valid.body as FeedbackInput,
        ),
    );
