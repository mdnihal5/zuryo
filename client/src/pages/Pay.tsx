import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { errorMessage } from "../api";
import { formatPaise } from "../lib/format";
import { completeGatewayOrder, getGatewayOrder, type GatewayOrder } from "../lib/mockpay";

// The hosted checkout page of MockPay, the stand-in payment gateway. It is deliberately not styled like the
// rest of Zuryo: a real gateway's page belongs to the gateway. It has no login and uses no Zuryo API; it only
// talks to MockPay, which then tells Zuryo's server by webhook. Going back to the app confirms nothing.

type Tab = "upi" | "card";

const field = "h-11 w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-base text-slate-800";

function TestValue({ label, value }: { label: string; value: string }) {
    return (
        <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-600">{label}</span>
            <input readOnly value={value} className={`${field} font-mono`} />
        </label>
    );
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-dvh bg-slate-200 sm:flex sm:items-start sm:justify-center sm:px-4 sm:py-10">
            <main className="w-full bg-white text-slate-900 sm:max-w-md sm:overflow-hidden sm:rounded-xl sm:shadow-lg">
                <header className="flex items-center justify-between bg-slate-900 px-5 py-4 text-white">
                    <span className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
                        <span
                            aria-hidden="true"
                            className="grid size-7 place-items-center rounded-md bg-teal-500 text-sm font-extrabold text-slate-900"
                        >
                            M
                        </span>
                        MockPay
                    </span>
                    <span className="rounded-full bg-amber-300 px-2.5 py-1 text-xs font-extrabold tracking-wide text-slate-900">
                        TEST MODE
                    </span>
                </header>
                {children}
            </main>
        </div>
    );
}

function Checkout({ order }: { order: GatewayOrder }) {
    const navigate = useNavigate();
    const [tab, setTab] = useState<Tab>("upi");
    const back = () => navigate(order.returnPath, { replace: true, state: { afterPayment: true } });
    const complete = useMutation({
        mutationFn: (outcome: "success" | "failure") => completeGatewayOrder(order.providerOrderId, outcome),
        onSuccess: back,
    });
    const amount = formatPaise(order.amountPaise);

    return (
        <>
            <section className="border-b border-slate-200 px-5 py-6">
                <p className="text-sm text-slate-600">Paying {order.merchant}</p>
                <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums">{amount}</p>
                <p className="mt-2 font-mono text-xs text-slate-500">Order {order.providerOrderId}</p>
            </section>

            <section className="px-5 py-5">
                <div
                    role="tablist"
                    aria-label="Payment method"
                    className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1"
                >
                    {(["upi", "card"] as const).map((t) => (
                        <button
                            key={t}
                            role="tab"
                            id={`tab-${t}`}
                            aria-selected={tab === t}
                            aria-controls={`panel-${t}`}
                            onClick={() => setTab(t)}
                            className={`h-10 rounded-md text-sm font-bold ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
                        >
                            {t === "upi" ? "UPI" : "Card"}
                        </button>
                    ))}
                </div>

                {tab === "upi" ? (
                    <div role="tabpanel" id="panel-upi" aria-labelledby="tab-upi" className="space-y-3">
                        <TestValue label="UPI ID (test value)" value="success@mockpay" />
                    </div>
                ) : (
                    <div role="tabpanel" id="panel-card" aria-labelledby="tab-card" className="space-y-3">
                        <TestValue label="Card number (test value)" value="4111 1111 1111 1111" />
                        <div className="grid grid-cols-2 gap-3">
                            <TestValue label="Expiry" value="12/30" />
                            <TestValue label="CVV" value="123" />
                        </div>
                    </div>
                )}

                {complete.isError && (
                    <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                        {errorMessage(complete.error)}
                    </p>
                )}

                <button
                    onClick={() => complete.mutate("success")}
                    disabled={complete.isPending}
                    className="mt-6 h-12 w-full rounded-lg bg-teal-700 text-base font-bold text-white hover:bg-teal-800 disabled:opacity-60"
                >
                    {complete.isPending ? "Processing" : `Pay ${amount}`}
                </button>
                <button
                    onClick={() => complete.mutate("failure")}
                    disabled={complete.isPending}
                    className="mt-3 h-12 w-full rounded-lg border border-red-300 text-base font-bold text-red-800 hover:bg-red-50 disabled:opacity-60"
                >
                    Simulate failure
                </button>
                <button
                    onClick={back}
                    disabled={complete.isPending}
                    className="mt-3 h-11 w-full text-base font-semibold text-slate-600 underline"
                >
                    Cancel
                </button>
            </section>

            <footer className="border-t border-slate-200 bg-slate-50 px-5 py-4 text-xs leading-relaxed text-slate-600">
                A simulated payment page: no real money moves. When you finish, MockPay tells Zuryo's server directly
                and Zuryo confirms from that message. Returning to the app does not confirm anything by itself.
            </footer>
        </>
    );
}

export default function Pay() {
    const { providerOrderId = "" } = useParams();
    const navigate = useNavigate();
    const order = useQuery({
        queryKey: ["gateway-order", providerOrderId],
        queryFn: () => getGatewayOrder(providerOrderId),
        retry: false,
        staleTime: 0,
    });

    return (
        <Shell>
            {order.isPending ? (
                <p role="status" className="px-5 py-10 text-slate-600">
                    Loading payment
                </p>
            ) : order.isError ? (
                <div role="alert" className="px-5 py-8">
                    <p className="font-bold text-red-800">{errorMessage(order.error)}</p>
                    <button onClick={() => navigate("/", { replace: true })} className="mt-4 font-semibold underline">
                        Back to Zuryo
                    </button>
                </div>
            ) : order.data.status === "pending" ? (
                <Checkout order={order.data} />
            ) : (
                <div className="px-5 py-8">
                    <p className="text-lg font-bold">
                        This payment is already {order.data.status === "paid" ? "paid" : "marked as failed"}.
                    </p>
                    <p className="mt-2 text-sm text-slate-600">Order {order.data.providerOrderId}</p>
                    <button
                        onClick={() =>
                            navigate(order.data.returnPath, { replace: true, state: { afterPayment: true } })
                        }
                        className="mt-5 h-12 w-full rounded-lg bg-teal-700 text-base font-bold text-white hover:bg-teal-800"
                    >
                        Back to Zuryo
                    </button>
                </div>
            )}
        </Shell>
    );
}
