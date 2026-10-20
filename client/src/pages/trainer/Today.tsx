import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { Chip, Empty, PageHeader, QueryState, SectionTitle, buttonClass } from "../../components/ui";
import { formatDay, formatDayTime, formatTime, istDate } from "../../lib/format";
import { serverTime } from "../../lib/clock";
import { POLL_MS, useNotifications } from "../../queries";
import type { Booking, Page } from "../../types";

function statusChip(b: Booking) {
    if (b.status === "in_progress")
        return (
            <Chip tone="good">
                <span className="size-1.5 rounded-full bg-live" />
                In progress
            </Chip>
        );
    if (b.status === "completed") return <Chip tone="good">Completed</Chip>;
    if (b.status === "cancelled") return <Chip tone="bad">Cancelled</Chip>;
    return <Chip tone="accent">Assigned</Chip>;
}

function SessionList({ items }: { items: Booking[] }) {
    return (
        <ul>
            {items.map((b) => (
                <li
                    key={b.id}
                    className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 border-b border-line py-4"
                >
                    <div>
                        <p className="font-extrabold tracking-heading">{formatTime(b.startsAt)}</p>
                        <p className="text-xs text-muted">{formatDay(b.startsAt)}</p>
                    </div>
                    <div className="min-w-0">
                        <p className="truncate font-bold">{b.customer?.name}</p>
                        <p className="text-sm text-muted">
                            #{b.id} · {b.mode}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {statusChip(b)}
                        {b.status !== "cancelled" && (
                            <Link
                                to={`/trainer/session/${b.id}`}
                                className={buttonClass(
                                    b.status === "confirmed" || b.status === "in_progress" ? "primary" : "soft",
                                    "sm",
                                )}
                            >
                                {b.status === "confirmed"
                                    ? "Open"
                                    : b.status === "in_progress"
                                      ? "Open timer"
                                      : "Record"}
                            </Link>
                        )}
                    </div>
                </li>
            ))}
        </ul>
    );
}

function Notifications() {
    const notes = useNotifications();
    const queryClient = useQueryClient();
    const markRead = useMutation({
        mutationFn: () => api("/notifications/read", { method: "POST" }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    });
    const unread = notes.data?.filter((n) => !n.readAt).length ?? 0;
    return (
        <section>
            <SectionTitle
                aside={
                    unread > 0 && (
                        <button onClick={() => markRead.mutate()} className="text-sm font-bold text-accent-ink">
                            Mark all read
                        </button>
                    )
                }
            >
                Notifications {unread > 0 && <Chip tone="accent">{unread} new</Chip>}
            </SectionTitle>
            <QueryState
                query={notes}
                isEmpty={notes.data?.length === 0}
                empty={<Empty title="Nothing yet" hint="Assignments, cancellations and reschedules appear here." />}
            >
                <ul>
                    {notes.data?.slice(0, 15).map((n) => (
                        <li key={n.id} className="border-b border-line py-3">
                            <p className={n.readAt ? "text-muted" : "font-semibold"}>{n.message}</p>
                            <p className="text-xs text-muted">{formatDayTime(n.createdAt)}</p>
                        </li>
                    ))}
                </ul>
            </QueryState>
        </section>
    );
}

export default function TrainerToday() {
    const upcoming = useQuery({
        queryKey: ["trainer-sessions", "upcoming"],
        queryFn: () => api<Page<Booking>>("/trainer/sessions?view=upcoming&limit=100"),
        refetchInterval: POLL_MS,
    });
    const history = useQuery({
        queryKey: ["trainer-sessions", "history"],
        queryFn: () => api<Page<Booking>>("/trainer/sessions?view=history&limit=10"),
        refetchInterval: POLL_MS,
    });
    const today = istDate(serverTime());
    const todays = upcoming.data?.items.filter((b) => istDate(Date.parse(b.startsAt)) === today) ?? [];
    const later = upcoming.data?.items.filter((b) => istDate(Date.parse(b.startsAt)) !== today) ?? [];

    return (
        <div>
            <PageHeader title="Today" subtitle="Your assigned sessions. Times are Kolkata time." />
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1.5fr)_1fr] lg:gap-16">
                <div className="space-y-10">
                    <section>
                        <SectionTitle>Today</SectionTitle>
                        <QueryState
                            query={upcoming}
                            isEmpty={todays.length === 0}
                            empty={
                                <Empty
                                    title="No sessions today"
                                    hint="New bookings are assigned to you automatically."
                                />
                            }
                        >
                            <SessionList items={todays} />
                        </QueryState>
                    </section>
                    {later.length > 0 && (
                        <section>
                            <SectionTitle>Coming up</SectionTitle>
                            <SessionList items={later} />
                        </section>
                    )}
                    <section>
                        <SectionTitle>Recent</SectionTitle>
                        <QueryState
                            query={history}
                            isEmpty={history.data?.items.length === 0}
                            empty={<Empty title="No past sessions yet" />}
                        >
                            <SessionList items={history.data?.items ?? []} />
                        </QueryState>
                    </section>
                </div>
                <Notifications />
            </div>
        </div>
    );
}
