import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { PriceBreakdown } from "../../components/Price";
import { Chip, PageHeader, QueryState, Row, SectionTitle, Stars } from "../../components/ui";
import { formatDayTime, formatTime } from "../../lib/format";
import { POLL_MS } from "../../queries";
import type { Booking } from "../../types";
import { statusChip } from "./Bookings";

const RULES = {
    preferred_trainer: "The customer's preferred trainer was eligible, so they were chosen.",
    fewest_sessions_then_nearest_then_id:
        "Among eligible trainers: fewest sessions that day, then nearest to the customer, then lowest trainer id.",
};

export default function AdminBooking() {
    const id = Number(useParams().id);
    const booking = useQuery({
        queryKey: ["admin-booking", id],
        queryFn: () => api<Booking>(`/admin/bookings/${id}`),
        refetchInterval: POLL_MS,
    });
    const b = booking.data;
    const a = b?.assignment;

    return (
        <QueryState query={booking}>
            {b && (
                <div>
                    <Link to="/admin" className="mb-3 inline-block text-sm font-bold text-accent">
                        Bookings
                    </Link>
                    <PageHeader
                        title={`Booking #${b.id}`}
                        subtitle={`${b.mode === "instant" ? "Instant" : "Scheduled"} booking for ${b.customer?.name}, ${formatDayTime(b.startsAt)}.`}
                    />
                    <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr] lg:gap-16">
                        <section>
                            <SectionTitle aside={statusChip(b)}>Assignment decision</SectionTitle>
                            {a ? (
                                <>
                                    <p className="rounded-md bg-good-bg px-4 py-3 text-good">
                                        <b>{b.trainer.name} assigned.</b> {RULES[a.rule]}
                                    </p>
                                    {a.preferredTrainerId !== null && (
                                        <p className="mt-3 text-sm text-muted">
                                            Preferred trainer:{" "}
                                            {a.candidates.find((c) => c.trainerId === a.preferredTrainerId)?.name ??
                                                `#${a.preferredTrainerId}`}
                                            , {a.preferredEligible ? "eligible" : "not eligible at that time"}.
                                        </p>
                                    )}
                                    <h3 className="mb-1 mt-6 text-sm font-semibold text-muted">
                                        Candidates, in ranked order
                                    </h3>
                                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-x-4 border-b border-line pb-2 text-sm font-semibold text-muted">
                                        <span>Trainer</span>
                                        <span>Sessions that day</span>
                                        <span>Distance</span>
                                        <span>Result</span>
                                    </div>
                                    <ul>
                                        {a.candidates.map((c, i) => (
                                            <li
                                                key={c.trainerId}
                                                className={`grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-x-4 border-b border-line px-1 py-3 ${c.trainerId === b.trainer.id ? "bg-accent-bg" : ""}`}
                                            >
                                                <span className="font-bold">{c.name}</span>
                                                <span>{c.sessionsThatDay}</span>
                                                <span>{c.distanceKm} km</span>
                                                {c.trainerId === b.trainer.id ? (
                                                    <Chip tone="good">Chosen</Chip>
                                                ) : (
                                                    <Chip>Rank {i + 1}</Chip>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                    {a.lostRaceTo.length > 0 && (
                                        <p className="mt-4 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn">
                                            A simultaneous booking took{" "}
                                            {a.lostRaceTo
                                                .map(
                                                    (id) =>
                                                        a.candidates.find((c) => c.trainerId === id)?.name ?? `#${id}`,
                                                )
                                                .join(", ")}{" "}
                                            first, so the next candidate was used.
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-muted">No assignment details were recorded.</p>
                            )}
                        </section>
                        <section>
                            <SectionTitle>Booking</SectionTitle>
                            <dl>
                                <Row label="Status">{statusChip(b)}</Row>
                                <Row label="Customer">{b.customer?.name}</Row>
                                <Row label="Trainer">{b.trainer.name}</Row>
                                <Row label="Slot">
                                    {formatDayTime(b.startsAt)} to {formatTime(b.endsAt)}
                                </Row>
                                <Row label="Payment">
                                    {b.payment.method === "package" ? "Package credit" : "Simulated, paid"}
                                    {b.payment.refunded && " (refunded)"}
                                </Row>
                                {b.feedback && (
                                    <Row label="Customer rating">
                                        <Stars value={b.feedback.rating} />
                                        {b.feedback.comment && (
                                            <span className="block text-sm text-muted">{b.feedback.comment}</span>
                                        )}
                                    </Row>
                                )}
                                {b.rescheduledFromId && <Row label="Moved from">#{b.rescheduledFromId}</Row>}
                                {b.rescheduledToId && <Row label="Moved to">#{b.rescheduledToId}</Row>}
                            </dl>
                            <h3 className="mb-1 mt-6 text-sm font-semibold text-muted">Price snapshot</h3>
                            <PriceBreakdown price={b.price} />
                            <p className="mt-4 text-xs text-muted">Later price changes do not touch this booking.</p>
                        </section>
                    </div>
                </div>
            )}
        </QueryState>
    );
}
