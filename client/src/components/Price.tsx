import { formatPaise } from "../lib/format";
import { usePackages } from "../queries";
import { useCheckout } from "../stores/checkout";
import type { Price } from "../types";

export function PriceBreakdown({ price }: { price: Price }) {
    const percent = Math.round((price.commissionPaise / price.sessionPricePaise) * 100);
    return (
        <dl>
            <div className="flex justify-between border-b border-line py-3">
                <dt className="text-muted">Session{price.isPeak ? " (peak slot)" : ""}</dt>
                <dd className="font-semibold">{formatPaise(price.sessionPricePaise)}</dd>
            </div>
            <div className="flex justify-between border-b border-line py-3">
                <dt className="text-muted">Society commission ({percent}%)</dt>
                <dd className="font-semibold">{formatPaise(price.commissionPaise)}</dd>
            </div>
            <div className="flex items-baseline justify-between pt-3">
                <dt className="font-bold">Total payable</dt>
                <dd className="text-2xl font-extrabold tracking-heading">{formatPaise(price.totalPaise)}</dd>
            </div>
        </dl>
    );
}

// Pay now, or take one session from a package. Shared by Book and Checkout so both edit the same draft.
export function PayChoice({ total }: { total: number }) {
    const packages = usePackages();
    const packageId = useCheckout((s) => s.packageId);
    const choose = useCheckout((s) => s.choose);
    const withCredit = packages.data?.find((p) => p.remaining > 0);

    if (!withCredit) return null;
    const options = [
        {
            id: null,
            title: "Pay now",
            detail: "Pay on the test payment page, no real money",
            right: formatPaise(total),
        },
        {
            id: withCredit.id,
            title: "Use a package credit",
            detail: `${withCredit.remaining} of ${withCredit.purchased} credits left`,
            right: "1 credit",
        },
    ];
    return (
        <fieldset className="space-y-2">
            <legend className="sr-only">Payment</legend>
            {options.map((o) => (
                <label
                    key={String(o.id)}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 ${packageId === o.id ? "border-ink bg-bg" : "border-line"}`}
                >
                    <input
                        type="radio"
                        name="payment"
                        className="size-4 accent-accent"
                        checked={packageId === o.id}
                        onChange={() => choose({ packageId: o.id })}
                    />
                    <span className="flex-1">
                        <span className="block font-bold">{o.title}</span>
                        <span className="block text-sm text-muted">{o.detail}</span>
                    </span>
                    <span className="font-bold">{o.right}</span>
                </label>
            ))}
        </fieldset>
    );
}
