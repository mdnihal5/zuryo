import { FREE_CANCEL_HOURS } from "../config/constants.js";
import { addMinutes } from "./ist.js";

// Free (refunded) cancellation or reschedule is allowed up to and including this instant.
export const freeCancelDeadline = (startsAt: Date) => addMinutes(startsAt, -FREE_CANCEL_HOURS * 60);
