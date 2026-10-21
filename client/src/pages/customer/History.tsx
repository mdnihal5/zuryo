import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "../../api";
import {
    Chip,
    Empty,
    ErrorState,
    Loading,
    PageHeader,
    QueryState,
    SectionTitle,
    Stars,
    buttonClass,
    inputClass,
} from "../../components/ui";
import { formatDay, formatDayTime } from "../../lib/format";
import { useBookings, usePackages, useProfile, useRecommendation, useRecord } from "../../queries";
import type { Booking, SessionRecord } from "../../types";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const focusOf = (r?: SessionRecord | null) => [...new Set(r?.exercises.map((e) => e.focus) ?? [])];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg bg-soft px-5 py-4">
            <p className="text-sm font-semibold text-muted">{label}</p>
            <p className="mt-1 text-2xl font-extrabold tracking-heading">{value}</p>
            {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
    );
}

function Progress({ sessions, minutes, minutesReady }: { sessions: number; minutes: number; minutesReady: boolean }) {
    const packages = usePackages();
    const profile = useProfile();
    const remaining = packages.data?.reduce((n, p) => n + p.remaining, 0);
    const purchased = packages.data?.reduce((n, p) => n + p.purchased, 0);
    return (
        <section aria-label="Progress" className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Sessions completed" value={String(sessions)} />
            <Stat
                label="Total training time"
                value={minutesReady ? `${minutes} min` : "-"}
                hint={minutesReady && minutes >= 60 ? `${(minutes / 60).toFixed(1)} hours` : undefined}
            />
            <Stat
                label="Package balance"
                value={remaining === undefined ? "-" : purchased ? `${remaining} left` : "None"}
                hint={purchased ? `of ${purchased} bought` : undefined}
            />
            <Stat
                label="Last assessment"
                value={profile.data ? formatDay(profile.data.updatedAt) : profile.isPending ? "-" : "Not done"}
                hint={profile.data ? undefined : "Add your profile"}
            />
        </section>
    );
}

function Detail({ booking }: { booking: Booking }) {
    const record = useRecord(booking.id);
    const queryClient = useQueryClient();
    const [picked, setPicked] = useState<number | null>(null);
    const [text, setText] = useState<string | null>(null);
    const save = useMutation({
        mutationFn: (body: { rating: number; comment: string }) =>
            api<SessionRecord>(`/bookings/${booking.id}/feedback`, { method: "PUT", body }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["record", booking.id] });
            queryClient.invalidateQueries({ queryKey: ["bookings", "history"] });
        },
    });
    const r = record.data;
    const rating = picked ?? r?.customerRating ?? 0;
    const comment = text ?? r?.customerComment ?? "";

    function submit(e: FormEvent) {
        e.preventDefault();
        if (rating) save.mutate({ rating, comment: comment.trim() });
    }

    return (
        <QueryState
            query={record}
            isEmpty={r === null}
            empty={<Empty title="No record yet" hint="Your trainer has not filled in the session record." />}
        >
            {r && (
                <div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-extrabold tracking-heading">
                                {focusOf(r).map(cap).join(" + ")} session
                            </h2>
                            <p className="mt-1 text-muted">
                                {formatDayTime(booking.startsAt)} · {booking.trainer.name} · #{booking.id}
                            </p>
                        </div>
                        <Chip tone="good">Completed</Chip>
                    </div>
                    <div className="mt-6 flex justify-between border-b border-line py-3">
                        <span className="text-muted">Duration</span>
                        <b>{r.durationMinutes} min</b>
                    </div>
                    <h3 className="mb-1 mt-6 text-sm font-semibold text-muted">Exercises completed</h3>
                    <ul>
                        {r.exercises.map((e, i) => (
                            <li key={i} className="flex justify-between gap-4 border-b border-line py-3">
                                <span className="font-bold">
                                    {e.name} <span className="font-medium text-muted">· {e.focus}</span>
                                </span>
                                <span className="text-muted">
                                    {[
                                        e.sets && e.reps
                                            ? `${e.sets} x ${e.reps}`
                                            : e.sets
                                              ? `${e.sets} sets`
                                              : e.reps
                                                ? `${e.reps} reps`
                                                : null,
                                        e.minutes ? `${e.minutes} min` : null,
                                    ]
                                        .filter(Boolean)
                                        .join(", ")}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {r.trainerNotes && (
                        <>
                            <h3 className="mb-1 mt-6 text-sm font-semibold text-muted">Trainer notes</h3>
                            <p>{r.trainerNotes}</p>
                        </>
                    )}
                    {r.suggestedNextWorkout && (
                        <>
                            <h3 className="mb-1 mt-6 text-sm font-semibold text-muted">Suggested next workout</h3>
                            <p className="font-bold">{r.suggestedNextWorkout}</p>
                        </>
                    )}
                    <form onSubmit={submit} className="mt-8 border-t border-line pt-6">
                        <h3 className="mb-3 text-lg font-extrabold tracking-heading">Your feedback</h3>
                        <div role="radiogroup" aria-label="Rating" className="mb-3 flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    role="radio"
                                    aria-checked={rating === n}
                                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                                    onClick={() => setPicked(n)}
                                    className={`size-11 rounded-md text-2xl ${n <= rating ? "text-warn" : "text-line"} hover:bg-soft`}
                                >
                                    ★
                                </button>
                            ))}
                        </div>
                        <label className="block">
                            <span className="sr-only">Comment</span>
                            <textarea
                                className={`${inputClass} h-28 py-3`}
                                maxLength={2000}
                                placeholder="What worked, what did not (optional)"
                                value={comment}
                                onChange={(e) => setText(e.target.value)}
                            />
                        </label>
                        {save.isError && (
                            <p role="alert" className="mt-2 text-sm font-semibold text-bad">
                                {errorMessage(save.error)}
                            </p>
                        )}
                        {save.isSuccess && (
                            <p role="status" className="mt-2 text-sm font-semibold text-good">
                                Feedback saved.
                            </p>
                        )}
                        <button
                            type="submit"
                            disabled={save.isPending || !rating}
                            className={`${buttonClass("primary", "sm")} mt-3`}
                        >
                            {save.isPending ? "Sending" : r.customerRating ? "Update feedback" : "Send feedback"}
                        </button>
                    </form>
                </div>
            )}
        </QueryState>
    );
}

function Recommended() {
    const rec = useRecommendation();
    if (rec.isPending) return <Loading label="Building your plan" />;
    if (rec.isError) {
        if (rec.error instanceof ApiError && rec.error.code === "PROFILE_REQUIRED") {
            return (
                <Empty
                    title="Add your profile first"
                    hint="Recommendations start from your goals and level."
                    action={
                        <Link to="/profile" className={buttonClass("primary", "sm")}>
                            Fill in profile
                        </Link>
                    }
                />
            );
        }
        return <ErrorState error={rec.error} retry={() => rec.refetch()} />;
    }
    const { engine, model, recommendation: r } = rec.data;
    return (
        <div>
            <div className="mb-3">
                <Chip tone="accent">
                    Source: {engine === "llm" ? `AI model${model ? ` (${model})` : ""}` : "Rules engine"}
                </Chip>
            </div>
            <h3 className="text-xl font-extrabold tracking-heading">{r.title}</h3>
            <p className="mt-1 text-sm text-muted">
                {r.durationMinutes} min · {r.intensity} · {r.focus.join(", ")}
            </p>
            <ul className="mt-4">
                {r.exercises.map((e) => (
                    <li key={e.name} className="border-b border-line py-2.5 text-sm">
                        <b>{e.name}</b>
                        <span className="block text-muted">{e.detail}</span>
                    </li>
                ))}
            </ul>
            <h4 className="mb-1 mt-5 text-sm font-semibold text-muted">Why this plan</h4>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {r.reasoning.map((x) => (
                    <li key={x}>{x}</li>
                ))}
            </ul>
            <Link to="/book" className={`${buttonClass("primary", "lg")} mt-5`}>
                Book this workout
            </Link>
            <p className="mt-2 text-xs text-muted">Suggestions are general fitness ideas, not medical advice.</p>
        </div>
    );
}

export default function History() {
    const history = useBookings("history");
    const [params] = useSearchParams();
    const [picked, setPicked] = useState<number | null>(Number(params.get("booking")) || null);
    const [trainerFilter, setTrainerFilter] = useState("");
    const [focusFilter, setFocusFilter] = useState("");

    const completed = history.data?.items.filter((b) => b.status === "completed") ?? [];
    const records = useQueries({
        queries: completed.map((b) => ({
            queryKey: ["record", b.id],
            queryFn: () => api<SessionRecord | null>(`/bookings/${b.id}/record`),
        })),
    });
    const recordOf = new Map(completed.map((b, i) => [b.id, records[i]?.data]));
    const minutes = records.reduce((n, r) => n + (r.data?.durationMinutes ?? 0), 0);
    const minutesReady = records.every((r) => !r.isPending);

    const trainers = [...new Map(completed.map((b) => [b.trainer.id, b.trainer.name])).entries()];
    const shown = completed.filter((b) => {
        if (trainerFilter && String(b.trainer.id) !== trainerFilter) return false;
        if (focusFilter && !focusOf(recordOf.get(b.id)).some((f) => f === focusFilter)) return false;
        return true;
    });
    const selected = completed.find((b) => b.id === picked) ?? shown[0];

    return (
        <div>
            <PageHeader
                title="Session history"
                subtitle="Every session record, your progress, and what to train next."
            />
            <Progress sessions={completed.length} minutes={minutes} minutesReady={minutesReady} />
            <div className="grid gap-12 lg:grid-cols-[19rem_minmax(0,1fr)_21rem] lg:gap-10">
                <section>
                    <SectionTitle>Past sessions</SectionTitle>
                    <div className="mb-3 grid grid-cols-2 gap-2">
                        <select
                            aria-label="Filter by trainer"
                            className={`${inputClass} h-10 text-sm`}
                            value={trainerFilter}
                            onChange={(e) => setTrainerFilter(e.target.value)}
                        >
                            <option value="">All trainers</option>
                            {trainers.map(([id, name]) => (
                                <option key={id} value={id}>
                                    {name}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="Filter by focus"
                            className={`${inputClass} h-10 text-sm`}
                            value={focusFilter}
                            onChange={(e) => setFocusFilter(e.target.value)}
                        >
                            <option value="">All focus areas</option>
                            {["upper", "lower", "core", "cardio", "mobility"].map((f) => (
                                <option key={f} value={f}>
                                    {cap(f)}
                                </option>
                            ))}
                        </select>
                    </div>
                    <QueryState
                        query={history}
                        isEmpty={completed.length === 0}
                        empty={
                            <Empty
                                title="No sessions yet"
                                hint="Completed sessions and their records show up here."
                                action={
                                    <Link to="/book" className={buttonClass("primary", "sm")}>
                                        Book a session
                                    </Link>
                                }
                            />
                        }
                    >
                        {shown.length === 0 ? (
                            <p className="rounded-md bg-soft px-4 py-3 text-sm text-muted">
                                No sessions match these filters.
                            </p>
                        ) : (
                            <ul>
                                {shown.map((b) => {
                                    const r = recordOf.get(b.id);
                                    const active = selected?.id === b.id;
                                    return (
                                        <li key={b.id} className="border-b border-line">
                                            <button
                                                onClick={() => setPicked(b.id)}
                                                aria-current={active}
                                                className={`w-full px-3 py-3 text-left ${active ? "bg-accent-bg" : "hover:bg-soft"}`}
                                            >
                                                <span className="flex items-baseline justify-between gap-2">
                                                    <b>{focusOf(r).map(cap).join(" + ") || "Session"}</b>
                                                    <span className="text-xs text-muted">
                                                        {r ? `${r.durationMinutes} min` : ""}
                                                    </span>
                                                </span>
                                                <span className="block text-sm text-muted">
                                                    {formatDay(b.startsAt)} · {b.trainer.name}
                                                </span>
                                                <span className="mt-1 block text-xs font-semibold">
                                                    {b.feedback ? (
                                                        <span>
                                                            You rated <Stars value={b.feedback.rating} />
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted">Not rated yet</span>
                                                    )}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </QueryState>
                </section>
                <section className="min-w-0">
                    {selected ? (
                        <Detail key={selected.id} booking={selected} />
                    ) : (
                        !history.isPending && (
                            <Empty title="Pick a session" hint="Select a session to see its record." />
                        )
                    )}
                </section>
                <aside>
                    <SectionTitle>Recommended next</SectionTitle>
                    <Recommended />
                </aside>
            </div>
        </div>
    );
}
