import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { PayChoice, PriceBreakdown } from "../../components/Price";
import { Avatar, Chip, ErrorState, Loading, PageHeader, buttonClass } from "../../components/ui";
import { addDays, dayParts, formatDay, formatPaise, formatTime, istDate, istToIso } from "../../lib/format";
import { serverTime } from "../../lib/clock";
import { POLL_MS, useTrainers } from "../../queries";
import { useQuote } from "../../useQuote";
import { useCheckout } from "../../stores/checkout";
import type { Slot } from "../../types";

const GRID = Array.from({ length: 32 }, (_, i) => {
    const minutes = 6 * 60 + i * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minutes % 60 === 0 ? "00" : "30"}`;
});
const MIN_LEAD_MS = 15 * 60_000;

function useSlots(date: string) {
    return useQuery({
        queryKey: ["slots", date],
        queryFn: () => api<{ date: string; slots: Slot[] }>(`/slots?date=${date}`),
        refetchInterval: POLL_MS,
    });
}

function SlotGrid({
    date,
    selected,
    onPick,
}: {
    date: string;
    selected: string | null;
    onPick: (iso: string) => void;
}) {
    const slots = useSlots(date);
    if (slots.isPending) return <Loading label="Loading slots" />;
    if (slots.isError) return <ErrorState error={slots.error} retry={() => slots.refetch()} />;
    const byTime = new Map(slots.data.slots.map((s) => [new Date(s.startsAt).toISOString(), s]));
    if (byTime.size === 0)
        return (
            <p className="rounded-md bg-soft px-4 py-3 text-muted">No trainer is free on this day. Try another date.</p>
        );

    return (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {GRID.map((hhmm) => {
                const iso = istToIso(date, hhmm);
                const slot = byTime.get(iso);
                const isSelected = selected !== null && new Date(selected).toISOString() === iso;
                if (!slot) {
                    const reason = new Date(iso).getTime() < serverTime() + MIN_LEAD_MS ? "Passed" : "No trainer";
                    return (
                        <button
                            key={hhmm}
                            disabled
                            className="flex h-12 flex-col items-center justify-center rounded-sm bg-soft text-sm font-semibold text-muted opacity-60"
                        >
                            {formatTime(iso)}
                            <span className="text-2xs font-bold uppercase tracking-wide">{reason}</span>
                        </button>
                    );
                }
                return (
                    <button
                        key={hhmm}
                        onClick={() => onPick(slot.startsAt)}
                        aria-pressed={isSelected}
                        className={`flex h-12 items-center justify-center gap-1.5 rounded-sm text-sm font-bold transition-colors ${
                            isSelected ? "bg-ink text-on-accent" : "bg-soft hover:bg-soft-hover"
                        }`}
                    >
                        {formatTime(slot.startsAt)}
                        {slot.isPeak && (
                            <span
                                className={`text-2xs font-extrabold ${isSelected ? "text-accent-bg" : "text-accent"}`}
                            >
                                {formatPaise(slot.sessionPricePaise).replace(".00", "")}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function TrainerChoice({ slotTrainers }: { slotTrainers: number[] | null }) {
    const trainers = useTrainers();
    const trainerId = useCheckout((s) => s.trainerId);
    const startsAt = useCheckout((s) => s.startsAt);
    const mode = useCheckout((s) => s.mode);
    const choose = useCheckout((s) => s.choose);

    if (trainers.isPending) return <Loading />;
    if (trainers.isError) return <ErrorState error={trainers.error} retry={() => trainers.refetch()} />;

    const statusFor = (id: number) => {
        if (mode === "instant" || !slotTrainers || !startsAt) return { free: true, text: "" };
        return slotTrainers.includes(id)
            ? { free: true, text: `Free at ${formatTime(startsAt)}` }
            : { free: false, text: "Busy at this time" };
    };

    return (
        <ul className="space-y-2">
            <li>
                <button
                    onClick={() => choose({ trainerId: null })}
                    aria-pressed={trainerId === null}
                    className={`flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left ${trainerId === null ? "border-ink" : "border-line hover:bg-soft"}`}
                >
                    <span className="flex size-10 items-center justify-center rounded-full bg-ink text-sm font-extrabold text-on-accent">
                        A
                    </span>
                    <span className="flex-1">
                        <span className="block font-bold">Auto-assign</span>
                        <span className="block text-sm text-muted">
                            Fewest sessions that day first, then nearest to you
                        </span>
                    </span>
                </button>
            </li>
            {trainers.data.map((t) => {
                const st = statusFor(t.id);
                const n = t.sessionsWithYou;
                return (
                    <li key={t.id}>
                        <button
                            disabled={!st.free}
                            onClick={() => choose({ trainerId: t.id })}
                            aria-pressed={trainerId === t.id}
                            className={`flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left disabled:opacity-50 ${trainerId === t.id ? "border-ink" : "border-line hover:bg-soft"}`}
                        >
                            <Avatar name={t.name} />
                            <span className="flex-1">
                                <span className="block font-bold">{t.name}</span>
                                <span className="flex flex-wrap gap-x-3 text-sm text-muted">
                                    <span className="whitespace-nowrap">
                                        {t.rating.average === null ? (
                                            "No ratings yet"
                                        ) : (
                                            <>
                                                <span className="text-warn">★</span> {t.rating.average.toFixed(1)} (
                                                {t.rating.count})
                                            </>
                                        )}
                                    </span>
                                    <span className="whitespace-nowrap">{t.distanceKm} km away</span>
                                    <span className="whitespace-nowrap">{t.experienceYears} yrs</span>
                                </span>
                                <span className="block text-sm text-muted">
                                    {t.specialties.join(", ")}
                                    {" · "}
                                    {n > 0 ? `${n} session${n === 1 ? "" : "s"} with you` : "New to you"}
                                </span>
                            </span>
                            <span
                                className={`w-20 shrink-0 text-right text-sm font-bold sm:w-auto ${st.free ? "text-good" : "text-muted"}`}
                            >
                                {st.text}
                            </span>
                        </button>
                    </li>
                );
            })}
            <li className="px-1 pt-1 text-sm text-muted">
                {mode === "instant"
                    ? "If your pick is not free right now, we assign the best free trainer."
                    : startsAt
                      ? "Trainers who are busy at this time cannot be picked."
                      : "Pick a time to see who is free."}
            </li>
        </ul>
    );
}

export default function Book() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const { mode, startsAt, trainerId, rescheduleOf, choose } = useCheckout();
    const [date, setDate] = useState(() => istDate(startsAt ? Date.parse(startsAt) : serverTime()));
    const quote = useQuote();
    const slots = useSlots(date);
    const today = istDate(serverTime());
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));

    // arriving with ?reschedule=ID turns this page into a reschedule; arriving without it clears one
    const rescheduleParam = Number(params.get("reschedule")) || null;
    useEffect(() => {
        choose(rescheduleParam ? { rescheduleOf: rescheduleParam, mode: "scheduled" } : { rescheduleOf: null });
    }, [rescheduleParam, choose]);

    // a slot picked earlier may have passed since
    useEffect(() => {
        if (startsAt && Date.parse(startsAt) < serverTime() + MIN_LEAD_MS) choose({ startsAt: null });
    }, [startsAt, choose]);

    const slotTrainers =
        slots.data?.slots
            .find((s) => startsAt && new Date(s.startsAt).getTime() === Date.parse(startsAt))
            ?.trainers.map((t) => t.id) ?? null;

    // a preferred trainer who is busy at the newly picked time is dropped
    useEffect(() => {
        if (mode === "scheduled" && trainerId !== null && slotTrainers && !slotTrainers.includes(trainerId))
            choose({ trainerId: null });
    }, [mode, trainerId, slotTrainers, choose]);

    const trainers = useTrainers();
    const preferredName = trainers.data?.find((t) => t.id === trainerId)?.name;
    const ready = mode === "instant" || startsAt !== null;
    const data = quote.data;

    const summary = (
        <div>
            <h2 className="mb-4 text-lg font-extrabold tracking-heading">Summary</h2>
            <dl className="mb-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                    <dt className="text-muted">When</dt>
                    <dd className="text-right font-semibold">
                        {mode === "instant"
                            ? data
                                ? `About ${formatTime(data.startsAt)}, today`
                                : "Starting soon"
                            : startsAt
                              ? `${formatDay(startsAt)}, ${formatTime(startsAt)}`
                              : "Pick a time"}
                    </dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-muted">Type</dt>
                    <dd className="font-semibold">
                        {mode === "instant" ? "Instant" : "Scheduled"} · 60 min{" "}
                        {data?.isPeak && <Chip tone="accent">Peak</Chip>}
                    </dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-muted">Trainer</dt>
                    <dd className="text-right font-semibold">
                        {preferredName ? `${preferredName} (your pick)` : "Auto-assigned"}
                        <span className="block text-xs font-medium text-muted">
                            {preferredName
                                ? "If they are not free we assign the next best"
                                : "Fewest sessions that day, then nearest"}
                        </span>
                    </dd>
                </div>
            </dl>
            {ready ? (
                quote.isPending ? (
                    <Loading label="Pricing" />
                ) : quote.isError ? (
                    <ErrorState error={quote.error} retry={() => quote.refetch()} />
                ) : (
                    <>
                        <PriceBreakdown price={quote.data} />
                        {!rescheduleOf && (
                            <div className="mt-5">
                                <PayChoice total={quote.data.totalPaise} />
                            </div>
                        )}
                    </>
                )
            ) : (
                <p className="rounded-md bg-soft px-4 py-3 text-sm text-muted">Pick a time to see the price.</p>
            )}
            <button
                disabled={!ready || !data}
                onClick={() => navigate("/checkout")}
                className={`${buttonClass("primary", "lg")} mt-5 hidden lg:inline-flex`}
            >
                Continue to checkout
            </button>
            <p className="mt-3 hidden text-xs text-muted lg:block">
                The final amount is calculated on the server at checkout.
            </p>
        </div>
    );

    return (
        <div className="pb-24 lg:pb-0">
            <PageHeader
                title={rescheduleOf ? "Reschedule session" : "Book a session"}
                subtitle={
                    rescheduleOf
                        ? "Pick a new time. Your old booking is cancelled and refunded when the new one is confirmed."
                        : "60 minutes, in your society."
                }
            />
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
                <div className="space-y-10">
                    <section>
                        <h2 className="mb-4 text-lg font-extrabold tracking-heading">1 · When</h2>
                        <div
                            role="group"
                            aria-label="Booking type"
                            className="mb-6 grid grid-cols-2 gap-1 rounded-pill bg-soft p-1"
                        >
                            {(["instant", "scheduled"] as const).map((m) => (
                                <button
                                    key={m}
                                    disabled={m === "instant" && rescheduleOf !== null}
                                    onClick={() => choose({ mode: m })}
                                    aria-pressed={mode === m}
                                    className={`h-11 rounded-pill text-base font-bold capitalize disabled:opacity-40 ${mode === m ? "bg-bg shadow-raised" : "text-muted"}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                        {mode === "instant" ? (
                            <div className="rounded-lg bg-accent-bg px-5 py-4 text-accent-ink">
                                <p className="font-bold">
                                    {quote.data
                                        ? `A trainer can start around ${formatTime(quote.data.startsAt)}`
                                        : "Finding the earliest start"}
                                </p>
                                <p className="mt-1 text-sm">
                                    That is about 15 minutes from now, the time a trainer needs to reach you. The
                                    booking is confirmed with the best free trainer.
                                </p>
                            </div>
                        ) : (
                            <>
                                <p className="mb-2 text-sm font-semibold text-muted">Pick a day</p>
                                <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
                                    {days.map((d) => {
                                        const p = dayParts(d);
                                        return (
                                            <button
                                                key={d}
                                                onClick={() => setDate(d)}
                                                aria-pressed={date === d}
                                                className={`flex w-16 shrink-0 flex-col items-center rounded-md py-2.5 ${date === d ? "bg-ink text-on-accent" : "bg-soft hover:bg-soft-hover"}`}
                                            >
                                                <span className="text-xs font-semibold opacity-70">
                                                    {d === today ? "Today" : p.weekday}
                                                </span>
                                                <span className="text-lg font-extrabold">{p.day}</span>
                                                <span className="text-xs font-semibold opacity-70">{p.month}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="mb-2 text-sm font-semibold text-muted">Pick a start time</p>
                                <SlotGrid date={date} selected={startsAt} onPick={(iso) => choose({ startsAt: iso })} />
                                <p className="mt-3 text-xs text-muted">
                                    Blue price marks a peak slot (6 to 9 AM and 6 to 9 PM, Kolkata time). Greyed times
                                    have no free trainer.
                                </p>
                            </>
                        )}
                    </section>
                    <section className="border-t border-line pt-8">
                        <h2 className="mb-4 text-lg font-extrabold tracking-heading">2 · Trainer</h2>
                        <TrainerChoice slotTrainers={slotTrainers} />
                    </section>
                </div>
                <aside className="hidden rounded-xl bg-soft p-6 lg:sticky lg:top-6 lg:block">{summary}</aside>
            </div>
            <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-4 border-t border-line bg-bg px-4 py-3 lg:hidden">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                        {mode === "instant"
                            ? "Instant session"
                            : startsAt
                              ? `${formatDay(startsAt)}, ${formatTime(startsAt)}`
                              : "Pick a time"}
                    </p>
                    <p className="text-lg font-extrabold">{data ? formatPaise(data.totalPaise) : "-"}</p>
                </div>
                <button
                    disabled={!ready || !data}
                    onClick={() => navigate("/checkout")}
                    className={buttonClass("primary")}
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
