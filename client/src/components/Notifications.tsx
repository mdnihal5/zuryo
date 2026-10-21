import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { formatDayTime } from "../lib/format";
import { useNotifications } from "../queries";
import { Chip, Empty, QueryState, SectionTitle } from "./ui";

export function Notifications() {
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
                empty={<Empty title="Nothing yet" hint="Bookings, changes and session alerts appear here." />}
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
