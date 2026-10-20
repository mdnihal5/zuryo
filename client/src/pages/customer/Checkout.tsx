import { useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "../../api";
import { PayChoice, PriceBreakdown } from "../../components/Price";
import { Chip, ErrorState, Loading, PageHeader, Row, SectionTitle, buttonClass } from "../../components/ui";
import { formatDayTime, formatPaise, formatTime } from "../../lib/format";
import { usePackages } from "../../queries";
import { useQuote } from "../../useQuote";
import { useCheckout } from "../../stores/checkout";
import type { Alternative, Booking } from "../../types";

export default function Checkout() {
    const { mode, startsAt, trainerId, packageId, rescheduleOf, idempotencyKey, choose, newKey, reset } = useCheckout();
    const quote = useQuote();
    const packages = usePackages();
    const trainers = useQuery({
        queryKey: ["trainers"],
        queryFn: () => api<{ id: number; name: string }[]>("/trainers"),
    });
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [notice, setNotice] = useState<string | null>(null);
    const paid = useRef(false); // set before the draft is cleared, so the empty-draft redirect below does not fire

    const pay = useMutation({
        mutationFn: () => {
            const choice = { ...(trainerId ? { preferredTrainerId: trainerId } : {}) };
            if (rescheduleOf) {
                return api<Booking>(`/bookings/${rescheduleOf}/reschedule`, {
                    method: "POST",
                    idempotencyKey,
                    body: { startsAt, ...choice },
                });
            }
            const body = mode === "instant" ? { mode, ...choice } : { mode, startsAt, ...choice };
            return api<Booking>("/bookings", {
                method: "POST",
                idempotencyKey,
                body: { ...body, ...(packageId ? { packageId } : {}) },
            });
        },
        onMutate: () => setNotice(null),
        onSuccess: (booking) => {
            paid.current = true;
            // Paying happens on the gateway's page. Only its webhook confirms the booking; we just go and wait.
            navigate(
                booking.status === "pending_payment"
                    ? `/pay/${booking.payment.providerOrderId}`
                    : `/confirmed/${booking.id}`,
                { replace: true },
            );
            reset();
            void queryClient.invalidateQueries({ queryKey: ["bookings"] });
            void queryClient.invalidateQueries({ queryKey: ["packages"] });
            void queryClient.invalidateQueries({ queryKey: ["slots"] });
        },
        onError: (err) => {
            // The same key was used for a different request: this attempt is stale, so start a fresh one.
            if (err instanceof ApiError && err.code === "IDEMPOTENCY_KEY_REUSED") {
                newKey();
                setNotice(
                    "That attempt was out of date, so we started a new one. Nothing was charged. Press pay again.",
                );
            }
        },
    });

    if (mode === "scheduled" && !startsAt && !paid.current) return <Navigate to="/book" replace />;

    const error = pay.error instanceof ApiError ? pay.error : null;
    const alternatives =
        error?.code === "NO_TRAINER_AVAILABLE"
            ? ((error.details as { alternatives?: Alternative[] } | undefined)?.alternatives ?? [])
            : null;
    const trainerName = trainers.data?.find((t) => t.id === trainerId)?.name;
    const credit = packageId !== null && !rescheduleOf;
    const q = quote.data;
    const verb = rescheduleOf
        ? "Confirm new time"
        : credit
          ? "Book with 1 credit"
          : q
            ? `Pay ${formatPaise(q.totalPaise)}`
            : "Pay";

    function pickAlternative(alt: Alternative) {
        choose({ mode: "scheduled", startsAt: alt.startsAt });
        pay.reset();
    }

    return (
        <div>
            <PageHeader
                eyebrow={rescheduleOf ? "Reschedule" : "Step 3 of 3"}
                title="Checkout"
                subtitle="Review the price, then confirm. Nothing is charged until you do."
            />
            <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
                <div className="space-y-10">
                    <section>
                        <SectionTitle>Your session</SectionTitle>
                        <dl>
                            <Row label="When">
                                {mode === "instant"
                                    ? q
                                        ? `About ${formatTime(q.startsAt)}, today · 60 min`
                                        : "Starting soon"
                                    : `${formatDayTime(startsAt!)} · 60 min`}
                            </Row>
                            <Row label="Type">
                                {mode === "instant" ? "Instant" : "Scheduled"}{" "}
                                {q?.isPeak && <Chip tone="accent">Peak</Chip>}
                            </Row>
                            <Row label="Trainer">{trainerName ? `${trainerName} (preferred)` : "Auto-assigned"}</Row>
                        </dl>
                    </section>
                    {!rescheduleOf && q && (
                        <section>
                            <SectionTitle>Payment</SectionTitle>
                            <PayChoice total={q.totalPaise} />
                            {!packages.data?.some((p) => p.remaining > 0) && (
                                <p className="rounded-md bg-soft px-4 py-3 text-sm text-muted">
                                    You will pay {formatPaise(q.totalPaise)} on the MockPay test page. No real money
                                    moves, and the slot is held for 10 minutes while you pay.
                                </p>
                            )}
                        </section>
                    )}
                </div>
                <section className="self-start rounded-xl bg-soft p-6">
                    <SectionTitle>Price breakdown</SectionTitle>
                    {quote.isPending ? (
                        <Loading label="Pricing" />
                    ) : quote.isError ? (
                        <ErrorState error={quote.error} retry={() => quote.refetch()} />
                    ) : (
                        <PriceBreakdown price={quote.data} />
                    )}
                    <p className="mt-4 text-xs text-muted">
                        The amount comes from the server's price rules for this slot. Your device sends only the slot
                        and the payment choice.
                    </p>

                    {notice && (
                        <p
                            role="status"
                            className="mt-4 rounded-md bg-warn-bg px-4 py-3 text-sm font-semibold text-warn"
                        >
                            {notice}
                        </p>
                    )}

                    {error && !alternatives && (
                        <div role="alert" className="mt-4 rounded-md bg-bad-bg px-4 py-3 text-sm text-bad">
                            <p className="font-bold">{errorMessage(error)}</p>
                            {error.code === "NETWORK" && (
                                <p className="mt-1">
                                    Your attempt keeps the same reference, so pressing the button again cannot charge
                                    you twice.
                                </p>
                            )}
                            {error.code === "CUSTOMER_ALREADY_BOOKED" && (
                                <Link to="/bookings" className="mt-1 inline-block font-bold underline">
                                    See your bookings
                                </Link>
                            )}
                        </div>
                    )}

                    {alternatives && (
                        <div role="alert" className="mt-4 rounded-md bg-warn-bg px-4 py-4 text-warn">
                            <p className="font-bold">No trainer is free at that time.</p>
                            {alternatives.length > 0 ? (
                                <>
                                    <p className="mt-1 text-sm">Nearby times that are free, tap one to switch:</p>
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        {alternatives.map((alt) => (
                                            <button
                                                key={alt.startsAt}
                                                onClick={() => pickAlternative(alt)}
                                                className="rounded-sm bg-bg px-3 py-2 text-left text-sm font-bold text-ink hover:bg-soft"
                                            >
                                                {formatDayTime(alt.startsAt)}
                                                <span className="block text-xs font-semibold text-muted">
                                                    {formatPaise(alt.totalPaise)}
                                                    {alt.isPeak ? " · Peak" : ""}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className="mt-1 text-sm">
                                    There are no later free slots right now. Try another day.
                                </p>
                            )}
                        </div>
                    )}

                    <button
                        onClick={() => pay.mutate()}
                        disabled={pay.isPending || !q}
                        className={`${buttonClass("primary", "lg")} mt-5`}
                    >
                        {pay.isPending ? "Holding your slot" : verb}
                    </button>
                    <p className="mt-3 text-xs text-muted">
                        Free cancellation until 2 hours before the session starts.
                    </p>
                    <Link to="/book" className="mt-3 inline-block text-sm font-bold text-accent-ink">
                        Change time or trainer
                    </Link>
                </section>
            </div>
        </div>
    );
}
