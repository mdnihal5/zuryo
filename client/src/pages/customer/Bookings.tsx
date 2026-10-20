import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../api";
import {
    Chip,
    Empty,
    ErrorState,
    Loading,
    PageHeader,
    QueryState,
    SectionTitle,
    buttonClass,
} from "../../components/ui";
import { formatDay, formatPaise, formatTime } from "../../lib/format";
import { useBookings, usePackages } from "../../queries";
import type { Booking, Pack } from "../../types";

type Filter = "all" | "upcoming" | "completed" | "cancelled" | "rescheduled";
const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "upcoming", label: "Upcoming" },
    { id: "completed", label: "Completed" },
    { id: "cancelled", label: "Cancelled" },
    { id: "rescheduled", label: "Rescheduled" },
];

function kind(b: Booking): Filter {
    if (b.status === "payment_failed" || b.status === "expired") return "cancelled";
    if (b.status === "cancelled") return b.cancellation.reason === "rescheduled" ? "rescheduled" : "cancelled";
    if (b.status === "completed") return "completed";
    return "upcoming";
}

function StatusChip({ b }: { b: Booking }) {
    if (b.status === "in_progress")
        return (
            <Chip tone="good">
                <span className="size-1.5 rounded-full bg-live" />
                In progress
            </Chip>
        );
    if (b.status === "pending_payment") return <Chip tone="warn">Awaiting payment</Chip>;
    if (b.status === "payment_failed") return <Chip tone="bad">Payment failed</Chip>;
    if (b.status === "expired") return <Chip tone="neutral">Expired</Chip>;
    const k = kind(b);
    if (k === "completed") return <Chip tone="good">Completed</Chip>;
    if (k === "cancelled") return <Chip tone="bad">Cancelled</Chip>;
    if (k === "rescheduled") return <Chip tone="warn">Rescheduled</Chip>;
    return <Chip tone="accent">Upcoming</Chip>;
}

function detail(b: Booking) {
    const paid = b.payment.method === "package" ? "1 credit" : formatPaise(b.price.totalPaise);
    if (b.status === "payment_failed" || b.status === "expired") {
        const why = b.status === "expired" ? "payment window ended" : "payment failed";
        return `#${b.id} · ${paid} · ${why}${b.payment.refunded ? ", refunded" : ""}`;
    }
    const parts = [`#${b.id}`, paid];
    if (b.price.isPeak) parts.push("Peak");
    if (b.rescheduledFromId) parts.push(`moved from #${b.rescheduledFromId}`);
    if (b.status === "cancelled") {
        parts.push(b.cancellation.reason === "rescheduled" ? `moved to #${b.rescheduledToId}` : "cancelled by you");
        parts.push(
            b.payment.refunded ? (b.payment.method === "package" ? "credit returned" : "refunded") : "no refund",
        );
    }
    return parts.join(" · ");
}

function BookingRow({ b }: { b: Booking }) {
    const [confirming, setConfirming] = useState(false);
    const queryClient = useQueryClient();
    const cancel = useMutation({
        mutationFn: () => api<Booking>(`/bookings/${b.id}/cancel`, { method: "POST" }),
        onSuccess: () => {
            setConfirming(false);
            for (const key of ["bookings", "packages", "slots", "booking"])
                void queryClient.invalidateQueries({ queryKey: [key] });
        },
    });
    const k = kind(b);

    return (
        <li className="grid gap-3 border-b border-line py-5 sm:grid-cols-[7rem_1fr_auto] sm:items-center sm:gap-5">
            <div>
                <p className="text-lg font-extrabold tracking-heading">{formatTime(b.startsAt)}</p>
                <p className="text-sm text-muted">{formatDay(b.startsAt)}</p>
            </div>
            <div className="min-w-0">
                <p className="font-bold">
                    {b.mode === "instant" ? "Instant" : "Scheduled"} session with {b.trainer.name}
                </p>
                <p className="text-sm text-muted">{detail(b)}</p>
                {confirming && (
                    <p className="mt-2 text-sm font-semibold text-warn">
                        {b.cancellation.canCancelFree
                            ? "Free cancellation, you will get it back."
                            : "Less than 2 hours to go: cancelling now gives nothing back."}
                    </p>
                )}
                {cancel.isError && (
                    <p role="alert" className="mt-2 text-sm font-semibold text-bad">
                        {errorMessage(cancel.error)}
                    </p>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <StatusChip b={b} />
                {k === "upcoming" && !confirming && (
                    <>
                        {b.status !== "pending_payment" && (
                            <Link
                                to={`/session/${b.id}`}
                                className={buttonClass(b.status === "in_progress" ? "primary" : "soft", "sm")}
                            >
                                {b.status === "in_progress" ? "Open session" : "Details"}
                            </Link>
                        )}
                        {b.status === "pending_payment" && (
                            <Link to={`/bookings/${b.id}/status`} className={buttonClass("primary", "sm")}>
                                Complete payment
                            </Link>
                        )}
                        {b.status === "confirmed" && (
                            <>
                                <Link to={`/book?reschedule=${b.id}`} className={buttonClass("soft", "sm")}>
                                    Reschedule
                                </Link>
                                <button onClick={() => setConfirming(true)} className={buttonClass("danger", "sm")}>
                                    Cancel
                                </button>
                            </>
                        )}
                    </>
                )}
                {confirming && (
                    <>
                        <button
                            onClick={() => cancel.mutate()}
                            disabled={cancel.isPending}
                            className={buttonClass("danger", "sm")}
                        >
                            {cancel.isPending ? "Cancelling" : "Yes, cancel"}
                        </button>
                        <button onClick={() => setConfirming(false)} className={buttonClass("soft", "sm")}>
                            Keep
                        </button>
                    </>
                )}
                {k === "completed" && (
                    <Link to={`/history?booking=${b.id}`} className={buttonClass("soft", "sm")}>
                        View record
                    </Link>
                )}
            </div>
        </li>
    );
}

function PackageCard({ justPaid }: { justPaid: boolean }) {
    // Back from the payment page the webhook may still be on its way: look again every 2 s for a short while.
    const [watching, setWatching] = useState(justPaid);
    useEffect(() => {
        if (!watching) return;
        const stop = setTimeout(() => setWatching(false), 20_000);
        return () => clearTimeout(stop);
    }, [watching]);
    const packages = usePackages(watching ? 2000 : false);
    const navigate = useNavigate();
    const buy = useMutation({
        mutationFn: (sessions: number) =>
            api<Pack>("/packages", { method: "POST", body: { sessions }, idempotencyKey: crypto.randomUUID() }),
        onSuccess: (pack) => navigate(`/pay/${pack.providerOrderId}`),
    });

    if (packages.isPending) return <Loading />;
    if (packages.isError) return <ErrorState error={packages.error} retry={() => packages.refetch()} />;
    const purchased = packages.data.reduce((n, p) => n + p.purchased, 0);
    const used = packages.data.reduce((n, p) => n + p.used, 0);
    const remaining = packages.data.reduce((n, p) => n + p.remaining, 0);

    return (
        <div>
            {purchased === 0 ? (
                <p className="text-muted">
                    You have no package. Buy sessions in bulk and book without paying each time.
                </p>
            ) : (
                <>
                    <p className="text-3xl font-extrabold tracking-display">
                        {remaining}{" "}
                        <span className="text-lg font-semibold tracking-normal text-muted">of {purchased} left</span>
                    </p>
                    <div className="mt-3 h-1.5 rounded-pill bg-soft">
                        <div
                            className="h-full rounded-pill bg-accent"
                            style={{ width: `${(remaining / purchased) * 100}%` }}
                        />
                    </div>
                    <dl className="mt-4">
                        {[
                            ["Purchased", purchased],
                            ["Used", used],
                            ["Remaining", remaining],
                        ].map(([label, value]) => (
                            <div key={label} className="flex justify-between border-b border-line py-3 last:border-b-0">
                                <dt className="text-muted">{label}</dt>
                                <dd className="font-bold">{value}</dd>
                            </div>
                        ))}
                    </dl>
                </>
            )}
            <p className="mb-2 mt-5 text-sm font-semibold text-muted">Buy a package (pay on the test payment page)</p>
            <div className="flex gap-2">
                {[5, 10, 20].map((n) => (
                    <button
                        key={n}
                        disabled={buy.isPending}
                        onClick={() => buy.mutate(n)}
                        className={buttonClass("soft", "sm")}
                    >
                        {n} sessions
                    </button>
                ))}
            </div>
            {buy.isError && (
                <p role="alert" className="mt-2 text-sm font-semibold text-bad">
                    {errorMessage(buy.error)}
                </p>
            )}
            <p className="mt-4 text-xs text-muted">
                A package becomes usable only after the payment gateway confirms it. A credit is taken once per booking,
                so a retry never charges twice. A cancelled session before the deadline returns its credit.
            </p>
        </div>
    );
}

export default function Bookings() {
    const afterPayment = Boolean((useLocation().state as { afterPayment?: boolean } | null)?.afterPayment);
    const [filter, setFilter] = useState<Filter>("all");
    const upcoming = useBookings("upcoming");
    const history = useBookings("history");

    const all = [...(upcoming.data?.items ?? []), ...(history.data?.items ?? [])];
    const shown = all.filter((b) => filter === "all" || kind(b) === filter);
    const query = upcoming.isError ? upcoming : history.isError ? history : upcoming.isPending ? upcoming : history;

    return (
        <div>
            <PageHeader title="Bookings and plan" subtitle="Your sessions, and what is left in your package." />
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
                <section>
                    <div
                        role="tablist"
                        aria-label="Filter bookings"
                        className="mb-2 flex gap-1 overflow-x-auto rounded-pill bg-soft p-1"
                    >
                        {FILTERS.map((f) => (
                            <button
                                key={f.id}
                                role="tab"
                                aria-selected={filter === f.id}
                                onClick={() => setFilter(f.id)}
                                className={`h-10 flex-1 whitespace-nowrap rounded-pill px-4 text-sm font-bold ${filter === f.id ? "bg-bg shadow-raised" : "text-muted"}`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                    <QueryState
                        query={query}
                        isEmpty={shown.length === 0}
                        empty={
                            <Empty
                                title={filter === "all" ? "No bookings yet" : "Nothing here"}
                                hint={
                                    filter === "all"
                                        ? "Book your first session in a minute."
                                        : "No bookings match this filter."
                                }
                                action={
                                    filter === "all" ? (
                                        <Link to="/book" className={buttonClass("primary", "sm")}>
                                            Book a session
                                        </Link>
                                    ) : undefined
                                }
                            />
                        }
                    >
                        <ul>
                            {shown.map((b) => (
                                <BookingRow key={b.id} b={b} />
                            ))}
                        </ul>
                    </QueryState>
                </section>
                <aside>
                    <SectionTitle>Your package</SectionTitle>
                    <PackageCard justPaid={afterPayment} />
                </aside>
            </div>
        </div>
    );
}
