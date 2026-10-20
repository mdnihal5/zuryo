import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, errorMessage } from "../../api";
import { Chip, Field, PageHeader, QueryState, SectionTitle, Stars, buttonClass, inputClass } from "../../components/ui";
import { audioReady, buzz, unlockAudio } from "../../lib/buzzer";
import { formatDayTime, formatTimeSeconds } from "../../lib/format";
import { crossed, elapsedFraction, formatCountdown, remainingMs, timerPhase, type SessionTimes } from "../../lib/timer";
import { useServerNow } from "../../lib/useNow";
import { POLL_MS } from "../../queries";
import type { Booking, Exercise, Focus, SessionRecord } from "../../types";

const FOCUS: Focus[] = ["upper", "lower", "core", "cardio", "mobility"];

type Row = { name: string; focus: Focus; sets: string; reps: string; minutes: string };
const blankRow = (): Row => ({ name: "", focus: "upper", sets: "", reps: "", minutes: "" });

const optionalInt = z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : Number(v)))
    .pipe(z.number().int().min(1, "Use a whole number").optional());
const rowSchema = z.object({
    name: z.string().trim().min(1, "Name every exercise"),
    focus: z.enum(FOCUS),
    sets: optionalInt,
    reps: optionalInt,
    minutes: optionalInt,
});
const recordSchema = z.object({
    exercises: z.array(rowSchema).min(1, "Add at least one exercise"),
    durationMinutes: z.coerce
        .number("Enter the duration")
        .int()
        .min(1, "Duration must be 1 to 240")
        .max(240, "Duration must be 1 to 240"),
    trainerNotes: z.string().trim().max(2000),
    suggestedNextWorkout: z.string().trim().max(500),
});

function RecordForm({ id, existing }: { id: number; existing: SessionRecord | null }) {
    const queryClient = useQueryClient();
    const [rows, setRows] = useState<Row[]>(
        existing?.exercises.length
            ? existing.exercises.map((e) => ({
                  name: e.name,
                  focus: e.focus,
                  sets: String(e.sets ?? ""),
                  reps: String(e.reps ?? ""),
                  minutes: String(e.minutes ?? ""),
              }))
            : [blankRow()],
    );
    const [duration, setDuration] = useState(String(existing?.durationMinutes ?? 60));
    const [notes, setNotes] = useState(existing?.trainerNotes ?? "");
    const [next, setNext] = useState(existing?.suggestedNextWorkout ?? "");
    const [error, setError] = useState<string | null>(null);

    const save = useMutation({
        mutationFn: (body: {
            exercises: Exercise[];
            durationMinutes: number;
            trainerNotes: string;
            suggestedNextWorkout: string;
        }) => api<SessionRecord>(`/trainer/sessions/${id}/record`, { method: "PUT", body }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["trainer-record", id] }),
    });

    const update = (i: number, change: Partial<Row>) =>
        setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));

    function submit(e: FormEvent) {
        e.preventDefault();
        const parsed = recordSchema.safeParse({
            exercises: rows,
            durationMinutes: duration,
            trainerNotes: notes,
            suggestedNextWorkout: next,
        });
        if (!parsed.success) {
            setError(parsed.error.issues[0]!.message);
            return;
        }
        setError(null);
        save.mutate(parsed.data);
    }

    return (
        <form onSubmit={submit} noValidate className="space-y-5">
            <fieldset>
                <legend className="mb-2 text-sm font-semibold text-muted">Exercises completed</legend>
                <div className="space-y-3">
                    {rows.map((r, i) => (
                        <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-line p-2.5">
                            <input
                                aria-label={`Exercise ${i + 1} name`}
                                placeholder="Exercise"
                                className={inputClass}
                                value={r.name}
                                onChange={(e) => update(i, { name: e.target.value })}
                            />
                            <select
                                aria-label={`Exercise ${i + 1} focus`}
                                className={`${inputClass} w-32`}
                                value={r.focus}
                                onChange={(e) => update(i, { focus: e.target.value as Focus })}
                            >
                                {FOCUS.map((f) => (
                                    <option key={f} value={f}>
                                        {f}
                                    </option>
                                ))}
                            </select>
                            <div className="col-span-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                                <input
                                    aria-label="Sets"
                                    placeholder="Sets"
                                    inputMode="numeric"
                                    className={inputClass}
                                    value={r.sets}
                                    onChange={(e) => update(i, { sets: e.target.value })}
                                />
                                <input
                                    aria-label="Reps"
                                    placeholder="Reps"
                                    inputMode="numeric"
                                    className={inputClass}
                                    value={r.reps}
                                    onChange={(e) => update(i, { reps: e.target.value })}
                                />
                                <input
                                    aria-label="Minutes"
                                    placeholder="Min"
                                    inputMode="numeric"
                                    className={inputClass}
                                    value={r.minutes}
                                    onChange={(e) => update(i, { minutes: e.target.value })}
                                />
                                {rows.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                                        className="px-2 text-sm font-bold text-bad"
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={() => setRows([...rows, blankRow()])}
                    className="mt-3 text-sm font-bold text-accent-ink"
                >
                    + Add exercise
                </button>
            </fieldset>
            <Field label="Duration (minutes)">
                <input
                    className={inputClass}
                    inputMode="numeric"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                />
            </Field>
            <Field label="Trainer notes">
                <textarea
                    className={`${inputClass} h-24 py-3`}
                    placeholder="Form, effort, anything to watch"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                />
            </Field>
            <Field label="Suggested next workout">
                <input
                    className={inputClass}
                    placeholder="e.g. Upper-body pull day"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                />
            </Field>
            {error && (
                <p role="alert" className="text-sm font-semibold text-bad">
                    {error}
                </p>
            )}
            {save.isError && (
                <p role="alert" className="text-sm font-semibold text-bad">
                    {errorMessage(save.error)}
                </p>
            )}
            {save.isSuccess && (
                <p role="status" className="text-sm font-semibold text-good">
                    Record saved. The customer can see it now.
                </p>
            )}
            <button type="submit" disabled={save.isPending} className={buttonClass("primary", "lg")}>
                {save.isPending ? "Saving" : "Save record"}
            </button>
        </form>
    );
}

export default function TrainerSession() {
    const id = Number(useParams().id);
    const queryClient = useQueryClient();
    const booking = useQuery({
        queryKey: ["trainer-session", id],
        queryFn: () => api<Booking>(`/trainer/sessions/${id}`),
        refetchInterval: POLL_MS,
    });
    const b = booking.data;
    const completed = b?.status === "completed";
    const record = useQuery({
        queryKey: ["trainer-record", id],
        queryFn: () => api<SessionRecord | null>(`/trainer/sessions/${id}/record`),
        enabled: completed,
    });
    const now = useServerNow();
    const [sound, setSound] = useState(audioReady());
    const prevNow = useRef(now);

    const start = useMutation({
        mutationFn: () => api<Booking>(`/trainer/sessions/${id}/start`, { method: "POST" }),
        onSuccess: (data) => {
            queryClient.setQueryData(["trainer-session", id], data);
            void queryClient.invalidateQueries({ queryKey: ["trainer-sessions"] });
        },
    });

    const times = b?.session.startedAt && b.session.endsAt && b.session.warningAt ? (b.session as SessionTimes) : null;
    const running = b?.status === "in_progress" && times !== null;

    // buzzer: the tick that crosses 55 and 60 minutes on the server clock
    useEffect(() => {
        if (running && times) {
            if (crossed(prevNow.current, now, times.warningAt)) buzz(3);
            if (crossed(prevNow.current, now, times.endsAt)) buzz(6);
        }
        prevNow.current = now;
    }, [now, running, times]);

    const over = times ? timerPhase(times, now) === "done" : false;
    useEffect(() => {
        if (over && b?.status === "in_progress")
            void queryClient.invalidateQueries({ queryKey: ["trainer-session", id] });
    }, [over, b?.status, id, queryClient]);

    function enableSound() {
        unlockAudio();
        setSound(true);
        buzz(1);
    }

    return (
        <QueryState query={booking}>
            {b && (
                <div>
                    <PageHeader
                        eyebrow={`#${b.id} · ${formatDayTime(b.startsAt)}`}
                        title={b.customer?.name ?? "Session"}
                        subtitle={`${b.mode === "instant" ? "Instant" : "Scheduled"} session, 60 minutes.`}
                    />
                    <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
                        <section>
                            <p className="mb-1 text-sm font-semibold text-muted">Time left</p>
                            {b.status === "confirmed" && (
                                <>
                                    <p className="text-4xl font-extrabold tracking-display">60:00</p>
                                    <p className="mt-2 text-muted">
                                        Ready. Start when you meet the customer. The server records the start and sets
                                        the end 60 minutes later.
                                    </p>
                                    <button
                                        onClick={() => {
                                            unlockAudio();
                                            setSound(true);
                                            start.mutate();
                                        }}
                                        disabled={start.isPending}
                                        className={`${buttonClass("primary")} mt-6`}
                                    >
                                        {start.isPending ? "Starting" : "Start session"}
                                    </button>
                                    {start.isError && (
                                        <p role="alert" className="mt-3 text-sm font-semibold text-bad">
                                            {errorMessage(start.error)}
                                        </p>
                                    )}
                                </>
                            )}
                            {running && times && (
                                <>
                                    <p className="text-4xl font-extrabold tracking-display sm:text-4xl" aria-live="off">
                                        {formatCountdown(remainingMs(times, now))}
                                    </p>
                                    <div className="mt-3 flex items-center gap-3">
                                        {timerPhase(times, now) === "warning" ? (
                                            <Chip tone="warn">5 minutes left, start the cool-down</Chip>
                                        ) : (
                                            <Chip tone="good">
                                                <span className="size-1.5 rounded-full bg-live" />
                                                Running
                                            </Chip>
                                        )}
                                    </div>
                                    <div
                                        className="relative mt-6 h-2 rounded-pill bg-soft"
                                        role="progressbar"
                                        aria-valuenow={Math.round(elapsedFraction(times, now) * 100)}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label="Session progress"
                                    >
                                        <div
                                            className="h-full rounded-pill bg-accent"
                                            style={{ width: `${elapsedFraction(times, now) * 100}%` }}
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
                                    <p className="mt-5 text-sm text-muted">
                                        Started {formatTimeSeconds(times.startedAt)}, ends{" "}
                                        {formatTimeSeconds(times.endsAt)}. This is the server clock, so a refresh or a
                                        closed app never loses the timer.
                                    </p>
                                    {!sound && (
                                        <button onClick={enableSound} className={`${buttonClass("soft", "sm")} mt-4`}>
                                            Turn on buzzer sound
                                        </button>
                                    )}
                                    {sound && (
                                        <p className="mt-4 text-sm font-semibold text-good">
                                            Buzzer on: it sounds at 55 and 60 minutes.
                                        </p>
                                    )}
                                </>
                            )}
                            {completed && (
                                <>
                                    <p className="text-4xl font-extrabold tracking-display">00:00</p>
                                    <div className="mt-3">
                                        <Chip tone="good">Session complete</Chip>
                                    </div>
                                    <p className="mt-3 text-muted">
                                        Fill in the record. The customer sees it and can rate the session.
                                    </p>
                                    {b.feedback && (
                                        <p className="mt-4 text-sm">
                                            Customer rating <Stars value={b.feedback.rating} />
                                            {b.feedback.comment && (
                                                <span className="block text-muted">{b.feedback.comment}</span>
                                            )}
                                        </p>
                                    )}
                                </>
                            )}
                            {b.status === "cancelled" && (
                                <div className="mt-2">
                                    <Chip tone="bad">Cancelled</Chip>
                                </div>
                            )}
                        </section>
                        {completed && (
                            <section>
                                <SectionTitle>Session record</SectionTitle>
                                <QueryState query={record}>
                                    <RecordForm id={id} existing={record.data ?? null} />
                                </QueryState>
                            </section>
                        )}
                    </div>
                </div>
            )}
        </QueryState>
    );
}
