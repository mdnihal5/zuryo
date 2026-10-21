import { pool } from "../db/pool.js";
import * as bookingsQueries from "../queries/bookings.queries.js";
import { completeDueSessions } from "./sessions.service.js";
import { PAGE_DEFAULT } from "../config/constants.js";
import { toBookingView } from "../lib/booking.mapper.js";
import { pageOf, type Cursor } from "../lib/cursor.js";
import { notFound } from "../lib/http-error.js";

type AdminFilters = {
    status?: string;
    mode?: string;
    from?: Date;
    to?: Date;
    trainerId?: number;
    customerId?: number;
    limit?: number;
    cursor: Cursor | null;
};

export async function listBookings(f: AdminFilters) {
    const now = new Date();
    await completeDueSessions(now);
    const limit = f.limit ?? PAGE_DEFAULT;
    const { limit: _l, cursor, ...filters } = f;
    const rows = await bookingsQueries.listForAdmin(pool, filters, { limit, cursor });
    return pageOf(rows, limit, (r) => toBookingView(r, now, "admin"));
}

export async function getBooking(id: number) {
    const now = new Date();
    await completeDueSessions(now);
    const row = await bookingsQueries.findForAdmin(pool, id);
    if (!row) throw notFound("BOOKING_NOT_FOUND", "No booking with that id.");
    return toBookingView(row, now, "admin");
}
