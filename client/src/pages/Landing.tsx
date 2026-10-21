import { Link } from "react-router";
import { errorMessage } from "../api";
import { DemoVideo } from "../components/DemoVideo";
import { Logo } from "../components/Layout";
import { Avatar, buttonClass } from "../components/ui";
import { formatPaise } from "../lib/format";
import { DEMO_PASSWORD, demoAccounts, useLogin } from "../lib/useLogin";

// The landing page is public and the API has no public pricing endpoint, so these mirror the seeded
// pricing rules. Checkout always shows the live price from the server.
const FEE_BPS = 1000;
const prices = [
    { label: "Off-peak", hours: "All other hours", sessionPaise: 39_900 },
    { label: "Peak", hours: "6–9 AM and 6–9 PM", sessionPaise: 49_900 },
].map((p) => ({ ...p, feePaise: (p.sessionPaise * FEE_BPS) / 10_000 }));

const steps = [
    {
        title: "Choose instant or scheduled",
        body: "Instant starts about 15 minutes after you book. Scheduled lets you pick a 30-minute slot up to 14 days ahead.",
    },
    {
        title: "See the price and pay",
        body: "The full breakdown is on screen before you pay, and the server fixes the price. Demo payments, no real money.",
    },
    {
        title: "Your trainer arrives",
        body: "A trainer from your society's zone is assigned. The server times the 60-minute session with a heads-up at 55 minutes.",
    },
];

const facts = [
    { value: "60 min", label: "per session" },
    { value: "14 days", label: "to book ahead" },
    { value: "2 hours", label: "free cancel or reschedule" },
    { value: "5, 10, 20", label: "session packages" },
    { value: "Refunds", label: "to how you paid, 2 h+ ahead" },
];

// YouTube id of the unlisted walkthrough; the section is hidden while it is empty.
const DEMO_VIDEO_ID = "Z7haQ4hFmts";

const demoRoles = [
    { email: "asha@zuryo.test", label: "Customer", hint: "Book and pay" },
    { email: "kiran@zuryo.test", label: "Trainer", hint: "Today's sessions" },
    { email: "admin@zuryo.test", label: "Admin", hint: "Prices and bookings" },
];

export default function Landing() {
    const login = useLogin();
    const trainer = demoAccounts.find((a) => a.role === "trainer")!;

    return (
        <div className="mx-auto max-w-page px-4 lg:px-10">
            <header className="flex items-center justify-between py-5">
                <Logo />
                <nav className="flex items-center gap-2">
                    <a href="#demo" className={`${buttonClass("ghost", "sm")} max-sm:hidden`}>
                        Try the demo
                    </a>
                    <Link to="/login" className={buttonClass("primary", "sm")}>
                        Book a session
                    </Link>
                </nav>
            </header>

            <section className="grid items-center gap-10 py-10 lg:grid-cols-2 lg:gap-16 lg:py-20">
                <div>
                    <p className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-accent-ink">
                        <span className="size-2 rounded-full bg-live" aria-hidden="true" />
                        Personal training for residential communities
                    </p>
                    <h1 className="text-3xl font-extrabold tracking-display lg:text-4xl">
                        A trainer at your door in <span className="text-accent">about 15 minutes.</span>
                    </h1>
                    <p className="mt-5 max-w-md text-md text-muted">
                        Book from home, get a trainer assigned, and start a 60-minute session. Or plan ahead: pick any
                        30-minute slot up to 14 days out.
                    </p>
                    <div className="mt-7 flex flex-wrap gap-3">
                        <Link to="/login" className={buttonClass("primary", "md")}>
                            Book a session
                        </Link>
                        <a href="#demo" className={buttonClass("soft", "md")}>
                            Try the demo
                        </a>
                    </div>
                </div>

                <div className="rounded-2xl bg-soft p-6 lg:p-8" aria-label="Example booking">
                    <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 rounded-pill bg-good-bg px-2.5 py-1 text-xs font-bold text-good">
                            <span className="size-1.5 rounded-full bg-good" aria-hidden="true" />
                            Trainer assigned
                        </span>
                        <span className="rounded-pill bg-bg px-2.5 py-1 text-xs font-bold text-muted">Instant</span>
                    </div>
                    <p className="mt-4 flex items-end gap-3">
                        <span className="text-[7rem] leading-none font-extrabold tracking-display lg:text-[9rem]">
                            15
                        </span>
                        <span className="pb-3 text-lg font-semibold leading-tight text-muted">
                            minutes
                            <br />
                            after you book
                        </span>
                    </p>
                    <p className="mt-4 font-bold">Booked 6:30 PM, starts 6:45 PM</p>
                    <p className="text-sm text-muted">Example booking, 60-minute session</p>
                    <div className="mt-4 flex items-center gap-3 rounded-xl bg-bg p-4">
                        <Avatar name={trainer.name} />
                        <div>
                            <p className="font-bold">{trainer.name}</p>
                            <p className="text-sm text-muted">Your trainer for today</p>
                        </div>
                    </div>
                </div>
            </section>

            <section className="py-12 lg:py-16">
                <h2 className="text-2xl font-extrabold tracking-heading">Book it in three steps.</h2>
                <ol className="mt-8 grid gap-8 md:grid-cols-3">
                    {steps.map((s, i) => (
                        <li key={s.title} className="border-t border-line pt-5">
                            <span className="text-2xl font-extrabold text-accent">{i + 1}</span>
                            <h3 className="mt-2 text-lg font-extrabold tracking-heading">{s.title}</h3>
                            <p className="mt-1 text-muted">{s.body}</p>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="grid items-center gap-10 py-12 lg:grid-cols-2 lg:gap-16 lg:py-16">
                <div>
                    <p className="mb-2 text-sm font-bold text-accent-ink">No surprises at checkout</p>
                    <h2 className="text-2xl font-extrabold tracking-heading lg:text-3xl">
                        The price you see is the price you pay.
                    </h2>
                    <p className="mt-4 max-w-md text-md text-muted">
                        The platform fee is its own line, not hidden in the price. Packages of 5, 10 or 20 sessions are
                        charged at the off-peak price, even when you use them at peak hours.
                    </p>
                </div>
                <div className="rounded-xl border border-line bg-bg p-6 shadow-sm lg:p-8">
                    <div className="flex items-baseline justify-between border-b border-dashed border-line pb-4">
                        <p className="font-bold">One 60-minute session</p>
                        <p className="text-xs text-muted">All prices in rupees</p>
                    </div>
                    <div className="grid gap-6 pt-4 sm:grid-cols-2">
                        {prices.map((p) => (
                            <dl key={p.label}>
                                <dt className="text-sm font-bold">{p.label}</dt>
                                <dd className="text-xs text-muted">{p.hours}</dd>
                                <div className="mt-3 flex justify-between border-b border-line py-2 text-sm">
                                    <dt className="text-muted">Session</dt>
                                    <dd className="font-semibold">{formatPaise(p.sessionPaise)}</dd>
                                </div>
                                <div className="flex justify-between border-b border-line py-2 text-sm">
                                    <dt className="text-muted">Platform fee, 10%</dt>
                                    <dd className="font-semibold">{formatPaise(p.feePaise)}</dd>
                                </div>
                                <dt className="mt-3 text-xs font-semibold">You pay</dt>
                                <dd className="text-2xl font-extrabold tracking-heading">
                                    {formatPaise(p.sessionPaise + p.feePaise)}
                                </dd>
                            </dl>
                        ))}
                    </div>
                </div>
            </section>

            <ul className="grid grid-cols-2 border-t border-ink sm:grid-cols-3 lg:grid-cols-5">
                {facts.map((f) => (
                    <li key={f.label} className="border-b border-line py-5 pr-4">
                        <p className="text-xl font-extrabold tracking-heading">{f.value}</p>
                        <p className="text-sm text-muted">{f.label}</p>
                    </li>
                ))}
            </ul>

            {DEMO_VIDEO_ID && (
                <section className="mx-auto max-w-4xl pt-12 lg:pt-16">
                    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 className="text-2xl font-extrabold tracking-heading">See it in four minutes.</h2>
                            <p className="mt-2 max-w-xl text-muted">
                                A walkthrough of booking, paying, the trainer's session and the admin view.
                            </p>
                        </div>
                        <a
                            href={`https://youtu.be/${DEMO_VIDEO_ID}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonClass("ghost", "sm")}
                        >
                            Watch on YouTube ↗
                        </a>
                    </div>
                    <div className="rounded-2xl border border-line bg-soft p-2 shadow-raised sm:p-3">
                        <DemoVideo videoId={DEMO_VIDEO_ID} title="Zuryo walkthrough" />
                    </div>
                </section>
            )}

            <section
                id="demo"
                className="my-12 grid scroll-mt-6 gap-8 rounded-2xl bg-ink p-6 text-bg lg:my-16 lg:grid-cols-2 lg:p-12"
            >
                <div>
                    <h2 className="text-2xl font-extrabold tracking-heading">Look around before you book.</h2>
                    <p className="mt-3 text-white/70">
                        Sign in to a demo account in one click and use the app as that person. Payments are simulated,
                        no real money moves.
                    </p>
                </div>
                <div className="space-y-3">
                    {demoRoles.map((r) => (
                        <button
                            key={r.email}
                            className="flex w-full items-center justify-between rounded-xl bg-white/10 px-5 py-4 text-left transition-colors hover:bg-white/15 disabled:opacity-50"
                            disabled={login.isPending}
                            onClick={() => login.mutate({ email: r.email, password: DEMO_PASSWORD })}
                        >
                            <span className="font-bold">{r.label}</span>
                            <span className="text-sm text-white/70">{r.hint}</span>
                        </button>
                    ))}
                    {login.isError && (
                        <p role="alert" className="text-sm font-semibold text-bad-bg">
                            {errorMessage(login.error)}
                        </p>
                    )}
                </div>
            </section>

            <footer className="flex flex-wrap justify-between gap-2 pb-8 text-xs text-muted">
                <span>Zuryo, personal training for residential communities.</span>
                <span>Demo payments, no real money.</span>
            </footer>
        </div>
    );
}
