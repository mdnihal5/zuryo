import { Link, useNavigate, useParams } from "react-router";
import { PriceBreakdown } from "../../components/Price";
import { Chip, PageHeader, QueryState, Row, SectionTitle, buttonClass } from "../../components/ui";
import { formatDayTime, formatTime } from "../../lib/format";
import { useServerNow } from "../../lib/useNow";
import { useBooking } from "../../queries";
import { useCheckout } from "../../stores/checkout";
import type { Booking } from "../../types";

function countdown(toIso: string, now: number) {
    const left = Math.max(0, Math.round((Date.parse(toIso) - now) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

const HEADINGS: Record<string, { title: string; tone: "good" | "warn" | "bad" | "neutral"; chip: string }> = {
    pending_payment: { title: "Waiting for payment", tone: "warn", chip: "Awaiting payment" },
    confirmed: { title: "Booking confirmed", tone: "good", chip: "Confirmed" },
    in_progress: { title: "Booking confirmed", tone: "good", chip: "In progress" },
    completed: { title: "Booking confirmed", tone: "good", chip: "Completed" },
    payment_failed: { title: "Payment failed", tone: "bad", chip: "Payment failed" },
    expired: { title: "Payment window ended", tone: "neutral", chip: "Expired" },
    cancelled: { title: "Booking cancelled", tone: "neutral", chip: "Cancelled" },
};

function Message({ b, now }: { b: Booking; now: number }) {
    const retry = useRetry();
    if (b.status === "pending_payment") {
        return (
            <div className="space-y-4">
                <p className="flex items-center gap-3 text-muted" role="status">
                    <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
                    We will confirm as soon as the payment gateway tells us the payment went through.
                </p>
                {b.payment.holdExpiresAt && (
                    <p className="font-semibold">
                        Your slot is held for{" "}
                        <span className="tabular-nums">{countdown(b.payment.holdExpiresAt, now)}</span>
                    </p>
                )}
                <p className="text-sm text-muted">
                    This page updates by itself. Coming back from the payment page does not confirm a booking; only the
                    gateway's message does.
                </p>
                {b.payment.providerOrderId && (
                    <Link to={`/pay/${b.payment.providerOrderId}`} className={buttonClass("soft")}>
                        Go to the payment page
                    </Link>
                )}
            </div>
        );
    }
    if (b.status === "payment_failed") {
        return (
            <div className="space-y-4">
                <p>The payment did not go through and nothing was charged. The slot was released.</p>
                <button onClick={retry} className={buttonClass("primary")}>
                    Book again
                </button>
            </div>
        );
    }
    if (b.status === "expired") {
        return (
            <div className="space-y-4">
                <p>
                    {b.payment.refunded
                        ? "Your payment arrived after the hold ended and the slot had been taken, so it is being refunded."
                        : "The 10 minute hold ended before a payment arrived, so the slot was released."}
                </p>
                <button onClick={retry} className={buttonClass("primary")}>
                    Book again
                </button>
            </div>
        );
    }
    return (
        <div className="flex gap-3">
            <Link to="/bookings" className={buttonClass("primary")}>
                View my bookings
            </Link>
            <Link to="/" className={buttonClass("soft")}>
                Back to home
            </Link>
        </div>
    );
}

function useRetry() {
    const navigate = useNavigate();
    const reset = useCheckout((s) => s.reset);
    return () => {
        reset();
        navigate("/book");
    };
}

export default function PaymentStatus() {
    const id = Number(useParams().id);
    const booking = useBooking(id);
    const now = useServerNow();
    const b = booking.data;
    const head = b ? (HEADINGS[b.status] ?? HEADINGS.cancelled) : null;

    return (
        <QueryState query={booking}>
            {b && head && (
                <div>
                    <PageHeader title={head.title} subtitle={`Session with ${b.trainer.name}`} />
                    <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
                        <section>
                            <SectionTitle>Booking</SectionTitle>
                            <dl>
                                <Row label="Booking">#{b.id}</Row>
                                <Row label="Status">
                                    <Chip tone={head.tone === "neutral" ? "neutral" : head.tone}>{head.chip}</Chip>
                                </Row>
                                <Row label="When">
                                    {formatDayTime(b.startsAt)} to {formatTime(b.endsAt)}
                                </Row>
                            </dl>
                            <div className="mt-6">
                                <Message b={b} now={now} />
                            </div>
                        </section>
                        <section className="self-start rounded-xl bg-soft p-6">
                            <SectionTitle>Amount</SectionTitle>
                            <PriceBreakdown price={b.price} />
                        </section>
                    </div>
                </div>
            )}
        </QueryState>
    );
}
