import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api";
import { homeFor } from "./routes";
import { useAuth } from "../stores/auth";
import type { Role, User } from "../types";

export const DEMO_PASSWORD = "Demo@12345";

export const demoAccounts: { name: string; email: string; role: Role; note: string }[] = [
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

export function useLogin() {
    const signIn = useAuth((s) => s.signIn);
    const navigate = useNavigate();
    return useMutation({
        mutationFn: (body: { email: string; password: string }) =>
            api<{ token: string; user: User }>("/auth/login", { method: "POST", body }),
        onSuccess: (data) => {
            signIn(data.token, data.user);
            navigate(homeFor[data.user.role]);
        },
    });
}
