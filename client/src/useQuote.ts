import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { POLL_MS } from "./queries";
import { useCheckout } from "./stores/checkout";
import type { Quote } from "./types";

// The server prices the choice. The client only displays what comes back.
export function useQuote() {
    const mode = useCheckout((s) => s.mode);
    const startsAt = useCheckout((s) => s.startsAt);
    const path =
        mode === "instant"
            ? "/quote?mode=instant"
            : `/quote?mode=scheduled&startsAt=${encodeURIComponent(startsAt ?? "")}`;
    return useQuery({
        queryKey: ["quote", mode, mode === "instant" ? null : startsAt],
        queryFn: () => api<Quote>(path),
        enabled: mode === "instant" || startsAt !== null,
        refetchInterval: mode === "instant" ? POLL_MS : false,
    });
}
