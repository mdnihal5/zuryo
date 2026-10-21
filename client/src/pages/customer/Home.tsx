import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Notifications } from "../../components/Notifications";
import { Avatar, Chip, ErrorState, Loading, buttonClass } from "../../components/ui";
import { formatDayTime } from "../../lib/format";
import { useBookings, usePackages, useProfile, useRecommendation } from "../../queries";
import { useAuth } from "../../stores/auth";
import { useCheckout } from "../../stores/checkout";

const HERO = "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1800&q=72&auto=format&fit=crop";

function NextBooking() {
    const upcoming = useBookings("upcoming");
    if (upcoming.isPending) return <Loading />;
    if (upcoming.isError) return <ErrorState error={upcoming.error} retry={() => upcoming.refetch()} />;
    const next = upcoming.data.items[0];
    if (!next) return <p className="mt-3 text-muted">Nothing booked yet.</p>;
    return (
        <>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-heading">
                {formatDayTime(next.startsAt)} {next.price.isPeak && <Chip tone="accent">Peak</Chip>}
            </p>
            <p className="mt-1 text-muted">60 min with {next.trainer.name}</p>
            <div className="mt-4 flex gap-2">
                <Link to={`/session/${next.id}`} className={buttonClass("soft", "sm")}>
                    Details
                </Link>
                <Link to="/bookings" className={buttonClass("soft", "sm")}>
                    All bookings
                </Link>
            </div>
        </>
    );
}

function PackageCard() {
    const packages = usePackages();
    if (packages.isPending) return <Loading />;
    if (packages.isError) return <ErrorState error={packages.error} retry={() => packages.refetch()} />;
    const remaining = packages.data.reduce((sum, p) => sum + p.remaining, 0);
    const purchased = packages.data.reduce((sum, p) => sum + p.purchased, 0);
    if (purchased === 0) {
        return (
            <>
                <p className="mt-3 text-muted">
                    No package yet. Buy sessions in bulk and book without paying each time.
                </p>
                <Link to="/bookings" className={`${buttonClass("soft", "sm")} mt-4`}>
                    View plans
                </Link>
            </>
        );
    }
    return (
        <>
            <p className="mt-3 text-3xl font-extrabold tracking-display">
                {remaining}{" "}
                <span className="text-lg font-semibold tracking-normal text-muted">of {purchased} left</span>
            </p>
            <div className="mt-3 h-1.5 rounded-pill bg-soft">
                <div className="h-full rounded-pill bg-accent" style={{ width: `${(remaining / purchased) * 100}%` }} />
            </div>
            <Link to="/bookings" className={`${buttonClass("soft", "sm")} mt-4`}>
                View plan
            </Link>
        </>
    );
}

function Recommended() {
    const rec = useRecommendation();
    const navigate = useNavigate();
    if (rec.isPending) return <Loading />;
    if (rec.isError) {
        if (rec.error instanceof ApiError && rec.error.code === "PROFILE_REQUIRED") {
            return (
                <>
                    <p className="mt-3 text-muted">
                        Tell us your goals and level and we will suggest what to train next.
                    </p>
                    <Link to="/profile" className={`${buttonClass("primary", "sm")} mt-4`}>
                        Fill in your profile
                    </Link>
                </>
            );
        }
        return <ErrorState error={rec.error} retry={() => rec.refetch()} />;
    }
    const r = rec.data.recommendation;
    return (
        <>
            <p className="mt-3 text-xl font-extrabold tracking-heading">{r.title}</p>
            <p className="mt-1 text-muted">{r.reasoning[0]}</p>
            <button className={`${buttonClass("primary", "sm")} mt-4`} onClick={() => navigate("/history")}>
                See the plan
            </button>
        </>
    );
}

function Trainers() {
    const trainers = useQuery({
        queryKey: ["trainers"],
        queryFn: () => api<{ id: number; name: string }[]>("/trainers"),
    });
    if (trainers.isPending) return <Loading />;
    if (trainers.isError) return <ErrorState error={trainers.error} retry={() => trainers.refetch()} />;
    if (trainers.data.length === 0) return <p className="text-muted">No trainers in your zone yet.</p>;
    return (
        <ul className="flex flex-wrap gap-8">
            {trainers.data.map((t) => (
                <li key={t.id} className="flex flex-col items-center gap-2">
                    <Avatar name={t.name} size="lg" />
                    <span className="font-bold">{t.name.split(" ")[0]}</span>
                </li>
            ))}
        </ul>
    );
}

export default function Home() {
    const user = useAuth((s) => s.user)!;
    const profile = useProfile();
    const choose = useCheckout((s) => s.choose);
    const navigate = useNavigate();

    function bookInstant() {
        choose({ mode: "instant", startsAt: null, rescheduleOf: null });
        navigate("/book");
    }

    return (
        <div className="space-y-14 lg:space-y-20">
            <section className="mx-auto max-w-3xl text-center">
                <p className="mb-4 text-sm font-bold text-accent">Hi {user.name.split(" ")[0]}</p>
                <h1 className="text-3xl font-extrabold tracking-display sm:text-4xl lg:text-4xl">Strong, on call.</h1>
                <p className="mx-auto mt-4 max-w-xl text-md text-muted lg:text-lg">
                    A trainer who serves your society, at your door within the hour. Or pick a slot that suits your
                    week.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                    <button onClick={bookInstant} className={buttonClass("primary")}>
                        Book instant session
                    </button>
                    <Link
                        to="/book"
                        onClick={() => choose({ mode: "scheduled", rescheduleOf: null })}
                        className={buttonClass("soft")}
                    >
                        Schedule for later
                    </Link>
                </div>
            </section>

            <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-soft sm:aspect-[16/7]">
                <img
                    src={HERO}
                    alt="A woman resting during a floor workout"
                    className="size-full object-cover"
                    fetchPriority="high"
                />
            </div>

            {profile.data === null && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent-bg px-5 py-4">
                    <p className="font-semibold text-accent-ink">
                        Your fitness profile is empty. Two minutes now gives you better recommendations.
                    </p>
                    <Link to="/profile" className={buttonClass("primary", "sm")}>
                        Complete profile
                    </Link>
                </div>
            )}

            <section className="grid gap-8 border-y border-line py-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
                <div className="md:pr-8">
                    <h2 className="text-sm font-semibold text-muted">Next booking</h2>
                    <NextBooking />
                </div>
                <div className="md:px-8">
                    <h2 className="text-sm font-semibold text-muted">Package</h2>
                    <PackageCard />
                </div>
                <div className="md:pl-8">
                    <h2 className="text-sm font-semibold text-muted">Recommended next</h2>
                    <Recommended />
                </div>
            </section>

            <div className="max-w-3xl">
                <Notifications />
            </div>

            <section>
                <h2 className="text-2xl font-extrabold tracking-display">Trainers near you</h2>
                <p className="mb-6 mt-1 text-muted">Trainers who work in your zone.</p>
                <Trainers />
            </section>
        </div>
    );
}
