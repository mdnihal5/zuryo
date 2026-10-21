import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { User } from "../types";

type AuthState = {
    token: string | null;
    user: User | null;
    signIn: (token: string, user: User) => void;
    signOut: () => void;
};

export const useAuth = create<AuthState>()(
    persist(
        (set) => ({
            token: null,
            user: null,
            signIn: (token, user) => set({ token, user }),
            signOut: () => set({ token: null, user: null }),
        }),
        { name: "zuryo-auth", storage: createJSONStorage(() => sessionStorage) },
    ),
);
