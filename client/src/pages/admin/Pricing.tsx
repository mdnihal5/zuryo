import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, errorMessage } from "../../api";
import { Field, PageHeader, QueryState, SectionTitle, buttonClass, inputClass } from "../../components/ui";
import { formatPaise } from "../../lib/format";
import type { PricingRules } from "../../types";

const schema = z.object({
    normal: z.coerce.number("Enter the normal price").min(1, "At least ₹1").max(100000, "At most ₹1,00,000"),
    peak: z.coerce.number("Enter the peak price").min(1, "At least ₹1").max(100000, "At most ₹1,00,000"),
    commission: z.coerce.number("Enter the commission").min(0, "0 to 50%").max(50, "0 to 50%"),
    windows: z
        .array(
            z
                .object({ start: z.string(), end: z.string() })
                .refine((w) => w.start < w.end, "Each window must start before it ends"),
        )
        .max(6),
});

function previewColumn(price: number, commission: number) {
    const fee = Math.round((price * commission) / 100);
    return { session: price, fee, total: price + fee };
}

function RulesForm({ rules }: { rules: PricingRules }) {
    const queryClient = useQueryClient();
    const [normal, setNormal] = useState(String(rules.normalPricePaise / 100));
    const [peak, setPeak] = useState(String(rules.peakPricePaise / 100));
    const [commission, setCommission] = useState(String(rules.commissionBps / 100));
    const [windows, setWindows] = useState(rules.peakWindows);
    const [error, setError] = useState<string | null>(null);

    const save = useMutation({
        mutationFn: (body: Omit<PricingRules, "updatedAt">) =>
            api<PricingRules>("/admin/pricing-rules", { method: "PUT", body }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pricing-rules"] }),
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        const parsed = schema.safeParse({ normal, peak, commission, windows });
        if (!parsed.success) return setError(parsed.error.issues[0]!.message);
        setError(null);
        const p = parsed.data;
        save.mutate({
            normalPricePaise: Math.round(p.normal * 100),
            peakPricePaise: Math.round(p.peak * 100),
            commissionBps: Math.round(p.commission * 100),
            peakWindows: p.windows,
        });
    }

    const pct = Number(commission) || 0;
    const columns = [
        { label: "Normal", ...previewColumn(Math.round((Number(normal) || 0) * 100), pct) },
        { label: "Peak", ...previewColumn(Math.round((Number(peak) || 0) * 100), pct) },
    ];
    const setWindow = (i: number, change: Partial<{ start: string; end: string }>) =>
        setWindows(windows.map((w, j) => (j === i ? { ...w, ...change } : w)));

    return (
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
            <form onSubmit={submit} noValidate className="space-y-8">
                <section>
                    <SectionTitle>Prices</SectionTitle>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <Field label="Normal slot (₹)">
                            <input
                                className={inputClass}
                                inputMode="decimal"
                                value={normal}
                                onChange={(e) => setNormal(e.target.value)}
                            />
                        </Field>
                        <Field label="Peak slot (₹)">
                            <input
                                className={inputClass}
                                inputMode="decimal"
                                value={peak}
                                onChange={(e) => setPeak(e.target.value)}
                            />
                        </Field>
                        <Field label="Society commission (%)">
                            <input
                                className={inputClass}
                                inputMode="decimal"
                                value={commission}
                                onChange={(e) => setCommission(e.target.value)}
                            />
                        </Field>
                    </div>
                </section>
                <section>
                    <SectionTitle>Peak windows (Kolkata time)</SectionTitle>
                    <ul className="space-y-3">
                        {windows.map((w, i) => (
                            <li key={i} className="flex items-center gap-3">
                                <input
                                    aria-label={`Window ${i + 1} start`}
                                    type="time"
                                    className={inputClass}
                                    value={w.start}
                                    onChange={(e) => setWindow(i, { start: e.target.value })}
                                />
                                <span className="text-muted">to</span>
                                <input
                                    aria-label={`Window ${i + 1} end`}
                                    type="time"
                                    className={inputClass}
                                    value={w.end}
                                    onChange={(e) => setWindow(i, { end: e.target.value })}
                                />
                                <button
                                    type="button"
                                    onClick={() => setWindows(windows.filter((_, j) => j !== i))}
                                    className="text-sm font-bold text-bad"
                                >
                                    Remove
                                </button>
                            </li>
                        ))}
                    </ul>
                    {windows.length < 6 && (
                        <button
                            type="button"
                            onClick={() => setWindows([...windows, { start: "12:00", end: "13:00" }])}
                            className="mt-3 text-sm font-bold text-accent-ink"
                        >
                            + Add window
                        </button>
                    )}
                    <p className="mt-3 text-sm text-muted">
                        A slot is peak when its start time falls inside any window. The start is included, the end is
                        not.
                    </p>
                </section>
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
                        Saved. New bookings use these rules; existing bookings keep their price.
                    </p>
                )}
                <button type="submit" disabled={save.isPending} className={buttonClass("primary")}>
                    {save.isPending ? "Saving" : "Save pricing rules"}
                </button>
            </form>
            <section className="self-start rounded-xl bg-soft p-6">
                <SectionTitle>Preview</SectionTitle>
                <table className="w-full text-left">
                    <thead>
                        <tr className="text-sm text-muted">
                            <th className="pb-2 font-semibold"></th>
                            {columns.map((c) => (
                                <th key={c.label} className="pb-2 text-right font-semibold">
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="border-t border-line">
                            <td className="py-3 text-muted">Session</td>
                            {columns.map((c) => (
                                <td key={c.label} className="py-3 text-right font-semibold">
                                    {formatPaise(c.session)}
                                </td>
                            ))}
                        </tr>
                        <tr className="border-t border-line">
                            <td className="py-3 text-muted">Commission</td>
                            {columns.map((c) => (
                                <td key={c.label} className="py-3 text-right font-semibold">
                                    {formatPaise(c.fee)}
                                </td>
                            ))}
                        </tr>
                        <tr className="border-t border-line">
                            <td className="py-3 font-bold">Total payable</td>
                            {columns.map((c) => (
                                <td key={c.label} className="py-3 text-right text-lg font-extrabold">
                                    {formatPaise(c.total)}
                                </td>
                            ))}
                        </tr>
                    </tbody>
                </table>
                <p className="mt-4 text-xs text-muted">
                    Preview only. The server does the real calculation when someone books.
                </p>
            </section>
        </div>
    );
}

export default function AdminPricing() {
    const rules = useQuery({ queryKey: ["pricing-rules"], queryFn: () => api<PricingRules>("/admin/pricing-rules") });
    return (
        <div>
            <PageHeader
                title="Pricing rules"
                subtitle="One place for prices. Checkout reads these, nothing is hardcoded."
            />
            <QueryState query={rules}>{rules.data && <RulesForm rules={rules.data} />}</QueryState>
        </div>
    );
}
