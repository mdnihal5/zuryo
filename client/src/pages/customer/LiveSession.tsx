import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Chip, PageHeader, QueryState, Row, SectionTitle, buttonClass } from "../../components/ui";
import { formatDayTime, formatPaise, formatTimeSeconds } from "../../lib/format";
import { elapsedFraction, formatCountdown, remainingMs, timerPhase, type SessionTimes } from "../../lib/timer";
import { useServerNow } from "../../lib/useNow";
import { useBooking } from "../../queries";

export default function LiveSession() {
    const id = Number(useParams().id);
    const booking = useBooking(id);
    const queryClient = useQueryClient();
    const now = useServerNow();
    const b = booking.data;
    const s = b?.session.startedAt && b.session.endsAt && b.session.warningAt ? (b.session as SessionTimes) : null;
    const finishedLocally = s ? timerPhase(s, now) === "done" : false;

    // our own clock says the hour is over: ask the server, which decides
    useEffect(() => {
        if (finishedLocally && b?.status === "in_progress")
            void queryClient.invalidateQueries({ queryKey: ["booking", id] });
    }, [finishedLocally, b?.status, id, queryClient]);

    let headline = "Starts soon";
    let tone: "accent" | "good" | "warn" | "bad" = "accent";
    let message = `${b?.trainer.name} is assigned and will start the timer.`;
    if (b?.status === "cancelled") {
        headline = "Cancelled";
        tone = "bad";
        message = "This booking was cancelled.";
    } else if (b?.status === "completed") {
        headline = "Completed";
        tone = "good";
        message = "Session complete. Your record and a next-workout suggestion are in History.";
    } else if (s) {
        const phase = timerPhase(s, now);
        if (phase === "warning") {
            headline = "5 minutes left";
            tone = "warn";
            message = "Your trainer will wrap up with a cool-down.";
        } else if (phase === "running") {
            headline = "In progress";
            tone = "good";
            message = "Your session is running.";
        } else {
            headline = "Wrapping up";
            tone = "good";
            message = "Time is up. Confirming with the server.";
        }
    }

    return (
        <QueryState query={booking}>
            {b && (
                <div>
                    <PageHeader
                        eyebrow={`Booking #${b.id}`}
                        title="Your session"
                        subtitle={`${formatDayTime(b.startsAt)} with ${b.trainer.name}. Times come from the server, not your phone.`}
                    />
                    <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-20">
                        <section>
                            <Chip tone={tone}>{headline}</Chip>
                            {s && b.status === "in_progress" ? (
                                <>
                                    <p className="mt-4 text-4xl font-extrabold tracking-display" aria-live="off">
                                        {formatCountdown(remainingMs(s, now))}
                                    </p>
                                    <p className="text-muted">left</p>
                                    <div
                                        className="relative mt-6 h-2 rounded-pill bg-soft"
                                        role="progressbar"
                                        aria-valuenow={Math.round(elapsedFraction(s, now) * 100)}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label="Session progress"
                                    >
                                        <div
                                            className="h-full rounded-pill bg-accent"
                                            style={{ width: `${elapsedFraction(s, now) * 100}%` }}
                                        />
                                        <span
                                            className="absolute -top-1 h-4 w-0.5 bg-ink"
                                            style={{ left: `${(55 / 60) * 100}%` }}
                                        />
                                    </div>
                                    <div className="mt-2 flex justify-between text-xs text-muted">
                                        <span>0</span>
                                        <span>55 min warning</span>
                                        <span>60 min</span>
                                    </div>
                                </>
                            ) : (
                                <p className="mt-4 text-xl font-extrabold tracking-heading">{message}</p>
                            )}
                            {s && <p className="mt-5 text-sm text-muted">{message}</p>}
                            {b.status === "completed" && (
                                <Link to={`/history?booking=${b.id}`} className={`${buttonClass("primary")} mt-6`}>
                                    View record
                                </Link>
                            )}
                            <p className="mt-8 text-xs text-muted">
                                If you close the app, this screen syncs from the server when you return.
                            </p>
                        </section>
                        <section>
                            <SectionTitle>Details</SectionTitle>
                            <dl>
                                <Row label="Trainer">{b.trainer.name}</Row>
                                <Row label="Booked for">{formatDayTime(b.startsAt)}</Row>
                                {b.session.startedAt && (
                                    <Row label="Started">{formatTimeSeconds(b.session.startedAt)}</Row>
                                )}
                                {b.session.warningAt && (
                                    <Row label="Warning at">{formatTimeSeconds(b.session.warningAt)}</Row>
                                )}
                                {b.session.endsAt && <Row label="Ends">{formatTimeSeconds(b.session.endsAt)}</Row>}
                                <Row label="Amount">
                                    {b.payment.method === "package"
                                        ? "1 package credit"
                                        : formatPaise(b.price.totalPaise)}
                                </Row>
                            </dl>
                        </section>
                    </div>
                </div>
            )}
        </QueryState>
    );
}
