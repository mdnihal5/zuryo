import type { Exercise, FitnessProfile, Recommendation, SessionHistoryItem } from "../types/index.js";

type Focus = Exercise["focus"];
const ALL_FOCUS: Focus[] = ["upper", "lower", "core", "cardio", "mobility"];

// Which body areas each stated goal leans on. Anything unmatched falls back to a balanced plan.
const GOAL_FOCUS: Record<string, Focus[]> = {
    "weight loss": ["cardio", "lower", "core"],
    "build muscle": ["upper", "lower", "core"],
    strength: ["upper", "lower"],
    endurance: ["cardio", "lower"],
    flexibility: ["mobility", "core"],
    "stress relief": ["mobility", "cardio"],
};

const LIBRARY: Record<Focus, string[]> = {
    upper: ["Push-ups", "Dumbbell rows", "Shoulder press"],
    lower: ["Bodyweight squats", "Lunges", "Glute bridges"],
    core: ["Plank", "Dead bug", "Bicycle crunches"],
    cardio: ["Brisk intervals", "Skipping", "Mountain climbers"],
    mobility: ["Hip openers", "Cat-cow and thoracic rotation", "Hamstring stretch"],
};

const INTENSITY = { beginner: "light", intermediate: "moderate", advanced: "hard" } as const;
const SETS = { beginner: "2 sets of 10", intermediate: "3 sets of 12", advanced: "4 sets of 12" } as const;

// Same inputs always give the same plan. Rule of thumb:
//   train the areas the customer's goals need, but start with the ones they trained least recently.
export function recommendByRules(profile: FitnessProfile, history: SessionHistoryItem[]): Recommendation {
    const reasoning: string[] = [];

    const wanted = new Set<Focus>();
    for (const g of profile.goals) for (const f of GOAL_FOCUS[g.toLowerCase()] ?? []) wanted.add(f);
    const goalAreas = wanted.size ? [...wanted] : ALL_FOCUS.filter((f) => f !== "mobility");
    reasoning.push(
        wanted.size
            ? `Your goals (${profile.goals.join(", ")}) lean on ${goalAreas.join(", ")}.`
            : "No recognised goal, so a balanced plan.",
    );

    // How recently was each area trained? Newest session = 0. Never trained = infinitely long ago.
    const sinceLast = new Map<Focus, number>(ALL_FOCUS.map((f) => [f, Infinity]));
    [...history]
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
        .forEach((s, i) => {
            for (const e of s.exercises) if (sinceLast.get(e.focus) === Infinity) sinceLast.set(e.focus, i);
        });

    const focus = [...goalAreas]
        .sort((a, b) => sinceLast.get(b)! - sinceLast.get(a)! || ALL_FOCUS.indexOf(a) - ALL_FOCUS.indexOf(b))
        .slice(0, 2);
    const lastSeen = (f: Focus) =>
        sinceLast.get(f) === Infinity ? "not trained recently" : `last trained ${sinceLast.get(f)! + 1} session(s) ago`;
    reasoning.push(`Focus on ${focus.map((f) => `${f} (${lastSeen(f)})`).join(" and ")}.`);

    const lowImpact = profile.age >= 50 || profile.preferences.some((p) => p.toLowerCase() === "low impact");
    if (lowImpact) reasoning.push("Low-impact variations are preferred for your age or stated preference.");

    let intensity: Recommendation["intensity"] = INTENSITY[profile.level];
    if (history.length === 0) {
        reasoning.push("No sessions yet, so this is an introductory plan.");
        intensity = "light";
    }

    const exercises = focus.flatMap((f) =>
        LIBRARY[f].slice(0, 2).map((name) => ({
            name: lowImpact && f === "cardio" ? `Low-impact ${name.toLowerCase()}` : name,
            detail: f === "cardio" || f === "mobility" ? "8-10 minutes" : SETS[profile.level],
        })),
    );

    return {
        title: `${focus.map((f) => f[0].toUpperCase() + f.slice(1)).join(" + ")} session`,
        focus,
        durationMinutes: 60,
        intensity,
        exercises,
        reasoning,
    };
}
