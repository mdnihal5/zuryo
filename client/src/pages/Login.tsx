import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { api, errorMessage } from "../api";
import { homeFor } from "../lib/routes";
import { Logo } from "../components/Layout";
import { Avatar, Field, buttonClass, inputClass } from "../components/ui";
import { useAuth } from "../stores/auth";
import type { Role, User } from "../types";

const PASSWORD = "Demo@12345";

const accounts: { name: string; email: string; role: Role; note: string }[] = [
    { name: "Asha Rao", email: "asha@zuryo.test", role: "customer", note: "Has a package, a profile and history" },
    { name: "Ravi Menon", email: "ravi@zuryo.test", role: "customer", note: "New customer, no profile or package" },
    { name: "Kiran Patel", email: "kiran@zuryo.test", role: "trainer", note: "Works every day, 6 AM to 9 PM" },
    {
        name: "Operations Admin",
        email: "admin@zuryo.test",
        role: "admin",
        note: "Bookings, assignment decisions, pricing",
    },
];

const schema = z.object({
    email: z.email("Enter a valid email"),
    password: z.string().min(1, "Enter your password"),
});

export default function Login() {
    const user = useAuth((s) => s.user);
    const signIn = useAuth((s) => s.signIn);
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

    const login = useMutation({
        mutationFn: (body: { email: string; password: string }) =>
            api<{ token: string; user: User }>("/auth/login", { method: "POST", body }),
        onSuccess: (data) => {
            signIn(data.token, data.user);
            navigate(homeFor[data.user.role]);
        },
    });

    if (user) return <Navigate to={homeFor[user.role]} replace />;

    function submit(e: FormEvent) {
        e.preventDefault();
        const parsed = schema.safeParse({ email, password });
        if (!parsed.success) {
            const issues = z.flattenError(parsed.error).fieldErrors;
            setFieldErrors({ email: issues.email?.[0], password: issues.password?.[0] });
            return;
        }
        setFieldErrors({});
        login.mutate(parsed.data);
    }

    return (
        <div className="mx-auto max-w-page px-4 py-6 lg:px-10">
            <Logo />
            <div className="mx-auto mt-10 grid max-w-4xl gap-10 lg:mt-16 lg:grid-cols-2 lg:gap-16">
                <section>
                    <p className="mb-2 text-sm font-bold text-accent">Demo access</p>
                    <h1 className="text-2xl font-extrabold tracking-display lg:text-3xl">Sign in to Zuryo</h1>
                    <p className="mt-2 text-md text-muted">
                        Pick a demo account, or type credentials. Every demo account uses the password {PASSWORD}.
                    </p>
                    <ul className="mt-6 divide-y divide-line border-y border-line">
                        {accounts.map((a) => (
                            <li key={a.email} className="flex items-center gap-3 py-3">
                                <Avatar name={a.name} />
                                <div className="min-w-0 flex-1">
                                    <p className="font-bold">
                                        {a.name} <span className="font-medium capitalize text-muted">· {a.role}</span>
                                    </p>
                                    <p className="truncate text-sm text-muted">
                                        {a.email} · {a.note}
                                    </p>
                                </div>
                                <button
                                    className={buttonClass("soft", "sm")}
                                    disabled={login.isPending}
                                    onClick={() => login.mutate({ email: a.email, password: PASSWORD })}
                                >
                                    Use
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
                <form onSubmit={submit} noValidate className="space-y-4 self-start rounded-xl bg-soft p-6">
                    <h2 className="text-lg font-extrabold tracking-heading">Email and password</h2>
                    <Field label="Email" error={fieldErrors.email}>
                        <input
                            className={inputClass}
                            type="email"
                            autoComplete="username"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </Field>
                    <Field label="Password" error={fieldErrors.password}>
                        <input
                            className={inputClass}
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </Field>
                    {login.isError && (
                        <p role="alert" className="text-sm font-semibold text-bad">
                            {errorMessage(login.error)}
                        </p>
                    )}
                    <button type="submit" className={buttonClass("primary", "lg")} disabled={login.isPending}>
                        {login.isPending ? "Signing in" : "Sign in"}
                    </button>
                    <p className="text-xs text-muted">
                        Demo only. The server checks your role on every request, hiding a screen is not security.
                    </p>
                </form>
            </div>
        </div>
    );
}
