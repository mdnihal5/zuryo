import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "./api";
import type { Booking, Notification, Pack, Page, Profile, Recommendation, SessionRecord, TrainerCard } from "./types";

export const POLL_MS = 30_000;

export const useProfile = () => useQuery({ queryKey: ["profile"], queryFn: () => api<Profile | null>("/profile") });

export const useTrainers = () => useQuery({ queryKey: ["trainers"], queryFn: () => api<TrainerCard[]>("/trainers") });

export const usePackages = (pollMs: number | false = false) =>
    useQuery({ queryKey: ["packages"], queryFn: () => api<Pack[]>("/packages"), refetchInterval: pollMs });

export const useBookings = (view: "upcoming" | "history") =>
    useQuery({
        queryKey: ["bookings", view],
        queryFn: () => api<Page<Booking>>(`/bookings?view=${view}&limit=100`),
        refetchInterval: POLL_MS,
    });

export const PENDING_POLL_MS = 2_000;

// While a booking waits for the payment gateway's webhook, ask every 2 s; afterwards the usual 30 s.
export const useBooking = (id: number) =>
    useQuery({
        queryKey: ["booking", id],
        queryFn: () => api<Booking>(`/bookings/${id}`),
        refetchInterval: (query) => (query.state.data?.status === "pending_payment" ? PENDING_POLL_MS : POLL_MS),
    });

export const useRecord = (id: number, enabled = true) =>
    useQuery({ queryKey: ["record", id], queryFn: () => api<SessionRecord | null>(`/bookings/${id}/record`), enabled });

export const useRecommendation = () =>
    useQuery({
        queryKey: ["recommendation"],
        queryFn: () => api<Recommendation>("/recommendations/next-workout"),
        retry: false,
    });

export const useNotifications = () =>
    useQuery({
        queryKey: ["notifications"],
        queryFn: () => api<Notification[]>("/notifications"),
        refetchInterval: POLL_MS,
    });

export { keepPreviousData };
