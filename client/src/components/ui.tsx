import type { ReactNode } from "react";
import { errorMessage } from "../api";

type Variant = "primary" | "soft" | "danger" | "ghost";

const base =
    "inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const variants: Record<Variant, string> = {
    primary: "bg-accent text-on-accent hover:bg-accent-hover",
    soft: "bg-soft text-ink hover:bg-soft-hover",
    danger: "bg-bad-bg text-bad hover:brightness-95",
    ghost: "text-accent-ink hover:bg-accent-bg",
};

export function buttonClass(variant: Variant = "primary", size: "sm" | "md" | "lg" = "md") {
    const sizes = { sm: "h-9 px-4 text-sm", md: "h-11 px-5 text-base", lg: "h-13 px-6 text-md w-full" };
    return `${base} ${variants[variant]} ${sizes[size]}`;
}

const chipTones = {
    neutral: "bg-soft text-muted",
    accent: "bg-accent-bg text-accent-ink",
    good: "bg-good-bg text-good",
    warn: "bg-warn-bg text-warn",
    bad: "bg-bad-bg text-bad",
};

export function Chip({ tone = "neutral", children }: { tone?: keyof typeof chipTones; children: ReactNode }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-bold ${chipTones[tone]}`}
        >
            {children}
        </span>
    );
}

export function Stars({ value }: { value: number }) {
    return (
        <span role="img" aria-label={`${value} out of 5`} className="text-warn">
            {"★".repeat(value)}
            <span className="text-line">{"★".repeat(5 - value)}</span>
        </span>
    );
}

export function PageHeader({ eyebrow, title, subtitle }: { eyebrow?: ReactNode; title: string; subtitle?: ReactNode }) {
    return (
        <header className="mb-8 lg:mb-10">
            {eyebrow && <div className="mb-2 text-sm font-bold text-accent">{eyebrow}</div>}
            <h1 className="text-2xl font-extrabold tracking-display lg:text-3xl">{title}</h1>
            {subtitle && <p className="mt-2 text-md text-muted">{subtitle}</p>}
        </header>
    );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
    return (
        <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold tracking-heading">{children}</h2>
            {aside}
        </div>
    );
}

export function Loading({ label = "Loading" }: { label?: string }) {
    return (
        <div role="status" className="flex items-center gap-3 py-10 text-muted">
            <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
            {label}
        </div>
    );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
    return (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-bad-bg px-4 py-3 text-sm text-bad">
            <span className="font-semibold">{errorMessage(error)}</span>
            {retry && (
                <button onClick={retry} className="font-bold underline">
                    Try again
                </button>
            )}
        </div>
    );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
    return (
        <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
            <p className="font-bold">{title}</p>
            {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
            {action && <div className="mt-4 flex justify-center">{action}</div>}
        </div>
    );
}

// Loading, error and empty in one place so every data view handles all three.
export function QueryState({
    query,
    isEmpty,
    empty,
    children,
}: {
    query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
    isEmpty?: boolean;
    empty?: ReactNode;
    children: ReactNode;
}) {
    if (query.isPending) return <Loading />;
    if (query.isError) return <ErrorState error={query.error} retry={() => query.refetch()} />;
    if (isEmpty) return <>{empty}</>;
    return <>{children}</>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-semibold">{children}</dd>
        </div>
    );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
    const initials = name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    const dims = size === "lg" ? "size-14 text-md" : "size-10 text-sm";
    return (
        <span
            className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-bg font-extrabold text-accent-ink ${dims}`}
        >
            {initials}
        </span>
    );
}

export const inputClass =
    "h-11 w-full rounded-sm border border-line bg-bg px-3.5 text-base placeholder:text-muted focus:border-accent focus:shadow-focus focus:outline-none";

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">{label}</span>
            {children}
            {error && <span className="mt-1 block text-sm text-bad">{error}</span>}
        </label>
    );
}

export function Pill({
    selected,
    disabled,
    onClick,
    children,
}: {
    selected: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={onClick}
            className={`h-10 rounded-pill px-4 text-sm font-semibold transition-colors disabled:opacity-45 ${
                selected ? "bg-ink text-on-accent" : "bg-soft text-ink hover:bg-soft-hover"
            }`}
        >
            {children}
        </button>
    );
}
