import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Chip, Empty, PageHeader, QueryState, inputClass } from "../../components/ui";
import { formatDayTime, formatPaise, istToIso } from "../../lib/format";
import { POLL_MS } from "../../queries";
import type { Booking, Page } from "../../types";

export function statusChip(b: Booking) {
    if (b.status === "in_progress")
        return (
            <Chip tone="good">
                <span className="size-1.5 rounded-full bg-live" />
                In progress
            </Chip>
        );
    if (b.status === "completed") return <Chip tone="good">Completed</Chip>;
    if (b.status === "cancelled")
        return b.cancellation.reason === "rescheduled" ? (
            <Chip tone="warn">Rescheduled</Chip>
        ) : (
            <Chip tone="bad">Cancelled</Chip>
        );
    if (b.status === "pending_payment") return <Chip tone="warn">Awaiting payment</Chip>;
    if (b.status === "payment_failed") return <Chip tone="bad">Payment failed</Chip>;
    if (b.status === "expired") return <Chip tone="neutral">Expired</Chip>;
    return <Chip tone="accent">Confirmed</Chip>;
}

const COLUMNS = "lg:grid-cols-[5rem_1.3fr_1fr_1fr_6rem_1.4fr_7rem]";

function useAdminBookings(query: string) {
    return useQuery({
        queryKey: ["admin-bookings", query],
        queryFn: () => api<Page<Booking>>(`/admin/bookings?limit=100${query}`),
        refetchInterval: POLL_MS,
    });
}

export default function AdminBookings() {
    const [status, setStatus] = useState("");
    const [mode, setMode] = useState("");
    const [trainerId, setTrainerId] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");

    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (mode) params.set("mode", mode);
    if (trainerId) params.set("trainerId", trainerId);
    if (from) params.set("from", istToIso(from, "00:00"));
    if (to) params.set("to", istToIso(to, "23:59"));
    const query = params.toString() ? `&${params}` : "";

    const bookings = useAdminBookings(query);
    const everything = useAdminBookings("");
    const trainers = [...new Map((everything.data?.items ?? []).map((b) => [b.trainer.id, b.trainer.name])).entries()];
    const items = bookings.data?.items ?? [];

    return (
        <div>
            <PageHeader
                title="Bookings"
                subtitle={`${items.length} booking${items.length === 1 ? "" : "s"}. Prices are the snapshot taken at booking time.`}
            />
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <select
                    aria-label="Status"
                    className={inputClass}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                >
                    <option value="">All statuses</option>
                    <option value="pending_payment">Awaiting payment</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled or rescheduled</option>
                    <option value="payment_failed">Payment failed</option>
                    <option value="expired">Expired</option>
                </select>
                <select aria-label="Mode" className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="">All types</option>
                    <option value="instant">Instant</option>
                    <option value="scheduled">Scheduled</option>
                </select>
                <select
                    aria-label="Trainer"
                    className={inputClass}
                    value={trainerId}
                    onChange={(e) => setTrainerId(e.target.value)}
                >
                    <option value="">All trainers</option>
                    {trainers.map(([id, name]) => (
                        <option key={id} value={id}>
                            {name}
                        </option>
                    ))}
                </select>
                <input
                    aria-label="From date"
                    type="date"
                    className={inputClass}
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                />
                <input
                    aria-label="To date"
                    type="date"
                    className={inputClass}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                />
            </div>
            <QueryState
                query={bookings}
                isEmpty={items.length === 0}
                empty={<Empty title="No bookings match these filters" />}
            >
                <div
                    className={`hidden gap-4 border-b border-line pb-3 text-sm font-semibold text-muted lg:grid ${COLUMNS}`}
                >
                    <span>Booking</span>
                    <span>When</span>
                    <span>Customer</span>
                    <span>Trainer</span>
                    <span>Type</span>
                    <span>Price snapshot</span>
                    <span>Status</span>
                </div>
                <ul>
                    {items.map((b) => (
                        <li key={b.id}>
                            <Link
                                to={`/admin/bookings/${b.id}`}
                                className={`grid gap-1 border-b border-line py-4 hover:bg-soft lg:items-center lg:gap-4 lg:px-0 ${COLUMNS}`}
                            >
                                <span className="font-bold text-accent-ink">#{b.id}</span>
                                <span className="font-semibold">{formatDayTime(b.startsAt)}</span>
                                <span>{b.customer?.name}</span>
                                <span>{b.trainer.name}</span>
                                <span className="capitalize">{b.mode}</span>
                                <span className="text-sm">
                                    {formatPaise(b.price.sessionPricePaise)} + {formatPaise(b.price.commissionPaise)} ={" "}
                                    <b>{formatPaise(b.price.totalPaise)}</b>
                                </span>
                                <span>{statusChip(b)}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            </QueryState>
        </div>
    );
}
