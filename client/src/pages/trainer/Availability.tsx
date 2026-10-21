import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, errorMessage } from "../../api";
import { Empty, Field, PageHeader, QueryState, SectionTitle, buttonClass, inputClass } from "../../components/ui";
import { formatDayTime, istInputToIso } from "../../lib/format";
import type { Availability } from "../../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type DayRow = { enabled: boolean; start: string; end: string };

function HoursForm({ data }: { data: Availability }) {
    const queryClient = useQueryClient();
    const [rows, setRows] = useState<DayRow[]>(() =>
        DAYS.map((_, i) => {
            const h = data.hours.find((x) => x.weekday === i + 1);
            return { enabled: !!h, start: h?.start ?? "06:00", end: h?.end ?? "21:00" };
        }),
    );
    const [error, setError] = useState<string | null>(null);
    const save = useMutation({
        mutationFn: (hours: { weekday: number; start: string; end: string }[]) =>
            api("/trainer/availability/hours", { method: "PUT", body: { hours } }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["availability"] }),
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        const bad = rows.findIndex((r) => r.enabled && r.start >= r.end);
        if (bad >= 0) return setError(`${DAYS[bad]}: the start must be before the end.`);
        setError(null);
        save.mutate(rows.flatMap((r, i) => (r.enabled ? [{ weekday: i + 1, start: r.start, end: r.end }] : [])));
    }

    const update = (i: number, change: Partial<DayRow>) =>
        setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));

    return (
        <form onSubmit={submit}>
            <ul>
                {rows.map((r, i) => (
                    <li
                        key={DAYS[i]}
                        className="grid grid-cols-[4rem_1fr] items-center gap-3 border-b border-line py-3 sm:grid-cols-[5rem_1fr_1fr_5rem]"
                    >
                        <label className="flex items-center gap-2 font-bold">
                            <input
                                type="checkbox"
                                className="size-4 accent-accent"
                                checked={r.enabled}
                                onChange={(e) => update(i, { enabled: e.target.checked })}
                            />
                            {DAYS[i]}
                        </label>
                        {r.enabled ? (
                            <>
                                <input
                                    aria-label={`${DAYS[i]} start`}
                                    type="time"
                                    className={inputClass}
                                    value={r.start}
                                    onChange={(e) => update(i, { start: e.target.value })}
                                />
                                <input
                                    aria-label={`${DAYS[i]} end`}
                                    type="time"
                                    className={`${inputClass} col-start-2 sm:col-start-auto`}
                                    value={r.end}
                                    onChange={(e) => update(i, { end: e.target.value })}
                                />
                            </>
                        ) : (
                            <span className="text-muted sm:col-span-2">Day off</span>
                        )}
                    </li>
                ))}
            </ul>
            {error && (
                <p role="alert" className="mt-3 text-sm font-semibold text-bad">
                    {error}
                </p>
            )}
            {save.isError && (
                <p role="alert" className="mt-3 text-sm font-semibold text-bad">
                    {errorMessage(save.error)}
                </p>
            )}
            {save.isSuccess && (
                <p role="status" className="mt-3 text-sm font-semibold text-good">
                    Hours saved. Existing bookings are not moved.
                </p>
            )}
            <button type="submit" disabled={save.isPending} className={`${buttonClass("primary")} mt-4`}>
                {save.isPending ? "Saving" : "Save hours"}
            </button>
        </form>
    );
}

const timeOffSchema = z
    .object({
        from: z.string().min(1, "Pick a start"),
        to: z.string().min(1, "Pick an end"),
        reason: z.string().trim().max(200),
    })
    .refine((v) => v.from < v.to, { message: "The end must be after the start", path: ["to"] });

function TimeOff({ data }: { data: Availability }) {
    const queryClient = useQueryClient();
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [reason, setReason] = useState("");
    const [error, setError] = useState<string | null>(null);
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["availability"] });

    const add = useMutation({
        mutationFn: (body: { startsAt: string; endsAt: string; reason: string }) =>
            api("/trainer/time-off", { method: "POST", body }),
        onSuccess: () => {
            setFrom("");
            setTo("");
            setReason("");
            void refresh();
        },
    });
    const remove = useMutation({
        mutationFn: (id: number) => api(`/trainer/time-off/${id}`, { method: "DELETE" }),
        onSuccess: refresh,
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        const parsed = timeOffSchema.safeParse({ from, to, reason });
        if (!parsed.success) return setError(parsed.error.issues[0]!.message);
        setError(null);
        add.mutate({ startsAt: istInputToIso(from), endsAt: istInputToIso(to), reason });
    }

    return (
        <div>
            {data.timeOff.length === 0 ? (
                <Empty title="No time off planned" />
            ) : (
                <ul className="mb-6">
                    {data.timeOff.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
                            <div>
                                <p className="font-bold">
                                    {formatDayTime(t.startsAt)} to {formatDayTime(t.endsAt)}
                                </p>
                                <p className="text-sm text-muted">{t.reason || "No reason given"}</p>
                            </div>
                            <button
                                onClick={() => remove.mutate(t.id)}
                                disabled={remove.isPending}
                                className={buttonClass("danger", "sm")}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {remove.isError && (
                <p role="alert" className="mb-3 text-sm font-semibold text-bad">
                    {errorMessage(remove.error)}
                </p>
            )}
            <form onSubmit={submit} noValidate className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="From (Kolkata time)">
                        <input
                            type="datetime-local"
                            className={inputClass}
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                        />
                    </Field>
                    <Field label="To (Kolkata time)">
                        <input
                            type="datetime-local"
                            className={inputClass}
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                        />
                    </Field>
                </div>
                <Field label="Reason (optional)">
                    <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                {error && (
                    <p role="alert" className="text-sm font-semibold text-bad">
                        {error}
                    </p>
                )}
                {add.isError && (
                    <p role="alert" className="text-sm font-semibold text-bad">
                        {errorMessage(add.error)}
                    </p>
                )}
                <button type="submit" disabled={add.isPending} className={buttonClass("soft")}>
                    {add.isPending ? "Adding" : "Add time off"}
                </button>
            </form>
        </div>
    );
}

export default function AvailabilityPage() {
    const availability = useQuery({
        queryKey: ["availability"],
        queryFn: () => api<Availability>("/trainer/availability"),
    });
    return (
        <div>
            <PageHeader
                title="Availability"
                subtitle="Customers can only book you inside these hours. Times are Kolkata time."
            />
            <QueryState query={availability}>
                {availability.data && (
                    <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
                        <section>
                            <SectionTitle>Weekly hours</SectionTitle>
                            <HoursForm key={availability.dataUpdatedAt} data={availability.data} />
                        </section>
                        <section>
                            <SectionTitle>Time off</SectionTitle>
                            <TimeOff data={availability.data} />
                        </section>
                    </div>
                )}
            </QueryState>
        </div>
    );
}
