import { Router } from "express";
import * as trainer from "../controllers/trainer.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParams } from "../schemas/common.schema.js";
import { hoursSchema, recordSchema, sessionsQuery, timeOffSchema } from "../schemas/trainer.schema.js";

export const trainerRoutes = Router();
trainerRoutes.use(requireAuth, requireRole("trainer"));

trainerRoutes.get("/sessions", validate({ query: sessionsQuery }), trainer.listSessions);
trainerRoutes.get("/sessions/:id", validate({ params: idParams }), trainer.getSession);
trainerRoutes.post("/sessions/:id/start", validate({ params: idParams }), trainer.start);
trainerRoutes.get("/sessions/:id/record", validate({ params: idParams }), trainer.getRecord);
trainerRoutes.put("/sessions/:id/record", validate({ params: idParams, body: recordSchema }), trainer.saveRecord);

trainerRoutes.get("/availability", trainer.getAvailability);
trainerRoutes.put("/availability/hours", validate({ body: hoursSchema }), trainer.setHours);
trainerRoutes.post("/time-off", validate({ body: timeOffSchema }), trainer.addTimeOff);
trainerRoutes.delete("/time-off/:id", validate({ params: idParams }), trainer.removeTimeOff);
