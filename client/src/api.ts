import { recordServerNow } from "./lib/clock";
import { useAuth } from "./stores/auth";

const BASE = `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/v1`;
const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
        public details?: unknown,
        public requestId?: string,
    ) {
        super(message);
    }
}

type Options = { method?: string; body?: unknown; idempotencyKey?: string };

export async function api<T>(path: string, { method = "GET", body, idempotencyKey }: Options = {}): Promise<T> {
    const headers: Record<string, string> = {};
    const token = useAuth.getState().token;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    let res: Response;
    try {
        res = await fetch(BASE + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        throw new ApiError(0, "NETWORK", "Could not reach the server. Check your connection and try again.");
    }

    const json = await res.json().catch(() => null);
    if (json?.serverNow) recordServerNow(json.serverNow);

    if (!res.ok) {
        const e = json?.error;
        if (res.status === 401 && e?.code === "UNAUTHENTICATED") useAuth.getState().signOut();
        throw new ApiError(
            res.status,
            e?.code ?? "UNKNOWN",
            e?.message ?? "Something went wrong.",
            e?.details,
            e?.requestId,
        );
    }
    return json.data as T;
}

export function errorMessage(err: unknown) {
    if (err instanceof ApiError) return err.message;
    return "Something went wrong.";
}
