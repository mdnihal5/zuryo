import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, errorMessage } from "../../api";
import { Field, PageHeader, Pill, QueryState, buttonClass, inputClass } from "../../components/ui";
import { useProfile } from "../../queries";
import type { Level, Profile } from "../../types";

const GOALS = ["weight loss", "build muscle", "strength", "endurance", "flexibility", "stress relief"];
const PREFERENCES = ["strength", "yoga", "hiit", "boxing", "cardio", "calisthenics", "low impact"];
const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];

const schema = z.object({
    age: z.number("Enter your age").int().min(10, "Age must be 10 to 100").max(100, "Age must be 10 to 100"),
    weightKg: z
        .number("Enter your weight")
        .min(20, "Weight must be 20 to 300 kg")
        .max(300, "Weight must be 20 to 300 kg"),
    goals: z.array(z.string()).min(1, "Pick at least one goal").max(6),
    level: z.enum(LEVELS),
    preferences: z.array(z.string()).max(10),
});

function toggle(list: string[], item: string) {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export default function Assessment() {
    const profile = useProfile();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [age, setAge] = useState("");
    const [weight, setWeight] = useState("");
    const [goals, setGoals] = useState<string[]>([]);
    const [level, setLevel] = useState<Level>("beginner");
    const [preferences, setPreferences] = useState<string[]>([]);
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        const p = profile.data;
        if (!p) return;
        setAge(String(p.age));
        setWeight(String(p.weightKg));
        setGoals(p.goals);
        setLevel(p.level);
        setPreferences(p.preferences);
    }, [profile.data]);

    const save = useMutation({
        mutationFn: (body: Omit<Profile, "updatedAt">) => api<Profile>("/profile", { method: "PUT", body }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["profile"] });
            void queryClient.invalidateQueries({ queryKey: ["recommendation"] });
            navigate("/");
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        const parsed = schema.safeParse({
            age: age === "" ? undefined : Number(age),
            weightKg: weight === "" ? undefined : Number(weight),
            goals,
            level,
            preferences,
        });
        if (!parsed.success) {
            const next: Record<string, string> = {};
            for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
            setErrors(next);
            return;
        }
        setErrors({});
        save.mutate(parsed.data);
    }

    return (
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <PageHeader
                eyebrow="Fitness profile"
                title="About you"
                subtitle="Your trainer and your workout recommendations start from these answers."
            />
            <QueryState query={profile}>
                <form onSubmit={submit} noValidate className="max-w-xl space-y-8">
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Age (years)" error={errors.age}>
                            <input
                                className={inputClass}
                                inputMode="numeric"
                                value={age}
                                onChange={(e) => setAge(e.target.value)}
                            />
                        </Field>
                        <Field label="Weight (kg)" error={errors.weightKg}>
                            <input
                                className={inputClass}
                                inputMode="decimal"
                                value={weight}
                                onChange={(e) => setWeight(e.target.value)}
                            />
                        </Field>
                    </div>
                    <fieldset>
                        <legend className="mb-2 text-sm font-semibold text-muted">Goals (pick up to 6)</legend>
                        <div className="flex flex-wrap gap-2">
                            {GOALS.map((g) => (
                                <Pill key={g} selected={goals.includes(g)} onClick={() => setGoals(toggle(goals, g))}>
                                    {g}
                                </Pill>
                            ))}
                        </div>
                        {errors.goals && <p className="mt-1 text-sm text-bad">{errors.goals}</p>}
                    </fieldset>
                    <fieldset>
                        <legend className="mb-2 text-sm font-semibold text-muted">Experience level</legend>
                        <div className="flex flex-wrap gap-2">
                            {LEVELS.map((l) => (
                                <Pill key={l} selected={level === l} onClick={() => setLevel(l)}>
                                    {l}
                                </Pill>
                            ))}
                        </div>
                    </fieldset>
                    <fieldset>
                        <legend className="mb-2 text-sm font-semibold text-muted">Workout preferences</legend>
                        <div className="flex flex-wrap gap-2">
                            {PREFERENCES.map((p) => (
                                <Pill
                                    key={p}
                                    selected={preferences.includes(p)}
                                    onClick={() => setPreferences(toggle(preferences, p))}
                                >
                                    {p}
                                </Pill>
                            ))}
                        </div>
                    </fieldset>
                    {save.isError && (
                        <p role="alert" className="text-sm font-semibold text-bad">
                            {errorMessage(save.error)}
                        </p>
                    )}
                    <button type="submit" className={buttonClass("primary", "lg")} disabled={save.isPending}>
                        {save.isPending ? "Saving" : "Save profile"}
                    </button>
                </form>
            </QueryState>
        </div>
    );
}
