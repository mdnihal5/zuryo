import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// What the customer picked. The idempotency key lives here so a retried Pay (even after a refresh)
// resends the same key. Any change to the choices makes a new key, because the request body changed.
type Choice = {
    mode: "instant" | "scheduled";
    startsAt: string | null;
    trainerId: number | null;
    packageId: number | null;
    rescheduleOf: number | null;
};

type CheckoutState = Choice & {
    idempotencyKey: string;
    choose: (changes: Partial<Choice>) => void;
    newKey: () => void;
    reset: () => void;
};

const empty: Choice = { mode: "scheduled", startsAt: null, trainerId: null, packageId: null, rescheduleOf: null };

export const useCheckout = create<CheckoutState>()(
    persist(
        (set, get) => ({
            ...empty,
            idempotencyKey: crypto.randomUUID(),
            choose: (changes) => {
                const s = get();
                const changed = (Object.keys(changes) as (keyof Choice)[]).some((k) => changes[k] !== s[k]);
                set(changed ? { ...changes, idempotencyKey: crypto.randomUUID() } : {});
            },
            newKey: () => set({ idempotencyKey: crypto.randomUUID() }),
            reset: () => set({ ...empty, idempotencyKey: crypto.randomUUID() }),
        }),
        { name: "zuryo-checkout", storage: createJSONStorage(() => sessionStorage) },
    ),
);
