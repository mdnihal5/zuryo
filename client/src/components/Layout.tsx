import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../stores/auth";
import { useCheckout } from "../stores/checkout";
import { buttonClass } from "./ui";
import type { Role } from "../types";

const links: Record<Role, { to: string; label: string; end?: boolean }[]> = {
    customer: [
        { to: "/", label: "Home", end: true },
        { to: "/book", label: "Book" },
        { to: "/bookings", label: "Plans" },
        { to: "/history", label: "History" },
        { to: "/profile", label: "Profile" },
    ],
    trainer: [
        { to: "/trainer", label: "Today", end: true },
        { to: "/trainer/availability", label: "Availability" },
    ],
    admin: [
        { to: "/admin", label: "Bookings", end: true },
        { to: "/admin/pricing", label: "Pricing" },
    ],
};

export function Logo() {
    return (
        <Link to="/" className="inline-flex items-center gap-2.5" aria-label="Zuryo home">
            <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
                <rect width="32" height="32" rx="8" fill="#0A62FF" />
                <path
                    d="M9 10h14l-9 12h9"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
            <span className="text-xl font-extrabold tracking-heading">Zuryo</span>
        </Link>
    );
}

export default function Layout() {
    const user = useAuth((s) => s.user);
    const signOut = useAuth((s) => s.signOut);
    const resetCheckout = useCheckout((s) => s.reset);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const hideTabs = pathname === "/book";

    if (!user) return <Navigate to="/login" replace />;
    const items = links[user.role];

    async function logout() {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        signOut();
        resetCheckout();
        queryClient.clear();
        navigate("/login");
    }

    const navClass = ({ isActive }: { isActive: boolean }) =>
        `rounded-pill px-4 py-2 text-base font-semibold ${isActive ? "bg-soft text-ink" : "text-muted hover:text-ink"}`;

    return (
        <div className="min-h-dvh pb-20 lg:pb-0">
            <header className="mx-auto flex h-18 max-w-page items-center justify-between gap-4 px-4 lg:px-10">
                <div className="flex items-center gap-3">
                    <Logo />
                    {user.role !== "customer" && (
                        <span className="rounded-pill bg-accent-bg px-2.5 py-1 text-xs font-bold capitalize text-accent-ink">
                            {user.role}
                        </span>
                    )}
                </div>
                <nav aria-label="Primary" className="hidden lg:flex lg:gap-1">
                    {items.map((l) => (
                        <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                            {l.label}
                        </NavLink>
                    ))}
                </nav>
                <div className="flex items-center gap-2">
                    {user.role === "customer" && (
                        <Link to="/book" className={`${buttonClass("primary", "sm")} hidden sm:inline-flex`}>
                            Book now
                        </Link>
                    )}
                    <span className="hidden text-sm font-semibold text-muted sm:inline">{user.name}</span>
                    <button onClick={logout} className={buttonClass("soft", "sm")}>
                        Sign out
                    </button>
                </div>
            </header>
            <main className="mx-auto max-w-page px-4 pb-16 pt-6 lg:px-10 lg:pt-10">
                <Outlet />
            </main>
            <footer className="px-4 pb-8 text-center text-xs text-muted">
                Demo build. All names and numbers are synthetic; payments are simulated.
            </footer>
            {!hideTabs && (
                <nav
                    aria-label="Main"
                    className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-bg lg:hidden"
                >
                    {items.map((l) => (
                        <NavLink
                            key={l.to}
                            to={l.to}
                            end={l.end}
                            className={({ isActive }) =>
                                `flex-1 py-4 text-center text-sm font-bold ${isActive ? "text-accent" : "text-muted"}`
                            }
                        >
                            {l.label}
                        </NavLink>
                    ))}
                </nav>
            )}
        </div>
    );
}
