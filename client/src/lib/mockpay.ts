import { ApiError } from "../api";

// MockPay is the stand-in for an external payment gateway, so its hosted page talks to it directly and
// not through api.ts: no bearer token, no /v1 prefix, just like a real gateway's checkout page.
const ORIGIN = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type GatewayOrder = {
    providerOrderId: string;
    merchant: string;
    amountPaise: number;
    currency: string;
    returnPath: string;
    status: "pending" | "paid" | "failed";
};

async function gateway(path: string, init?: RequestInit): Promise<GatewayOrder> {
    let res: Response;
    try {
        res = await fetch(`${ORIGIN}/mockpay${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch {
        throw new ApiError(0, "NETWORK", "Could not reach the payment gateway. Check your connection and try again.");
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        const e = json?.error;
        throw new ApiError(res.status, e?.code ?? "UNKNOWN", e?.message ?? "Something went wrong.");
    }
    return json.data as GatewayOrder;
}

export const getGatewayOrder = (providerOrderId: string) => gateway(`/orders/${encodeURIComponent(providerOrderId)}`);

export const completeGatewayOrder = (providerOrderId: string, outcome: "success" | "failure") =>
    gateway(`/orders/${encodeURIComponent(providerOrderId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
    });
