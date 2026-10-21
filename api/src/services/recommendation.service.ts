import { z } from "zod";
import { pool } from "../db/pool.js";
import * as profileQueries from "../queries/profile.queries.js";
import { recommendByRules } from "../lib/recommend-rules.js";
import { askModel } from "../lib/openrouter.js";
import { config } from "../config/index.js";
import { unprocessable } from "../lib/http-error.js";
import { log } from "../lib/logger.js";
import type { AuthUser, FitnessProfile, Recommendation, SessionHistoryItem } from "../types/index.js";

const HISTORY_LENGTH = 5;

const llmShape = z.object({
    title: z.string().min(1).max(100),
    focus: z.array(z.string().max(30)).min(1).max(4),
    durationMinutes: z.number().int().min(15).max(120),
    intensity: z.enum(["light", "moderate", "hard"]),
    exercises: z
        .array(z.object({ name: z.string().max(80), detail: z.string().max(120) }))
        .min(2)
        .max(10),
    reasoning: z.array(z.string().max(300)).min(1).max(6),
});

const SYSTEM =
    "You are a fitness coach assistant. Given a structured profile and recent session history, propose the next 60-minute workout. " +
    "Stay within general fitness; no medical advice. Reply with JSON only: " +
    '{"title":string,"focus":string[],"durationMinutes":number,"intensity":"light"|"moderate"|"hard",' +
    '"exercises":[{"name":string,"detail":string}],"reasoning":string[]}';

// Only structured fields leave the server: no name, email, ids, or free text.
async function askLlm(profile: FitnessProfile, history: SessionHistoryItem[]): Promise<Recommendation> {
    const payload = {
        profile: {
            age: profile.age,
            weightKg: profile.weight_kg,
            goals: profile.goals,
            level: profile.level,
            preferences: profile.preferences,
        },
        recentSessions: history.map((s) => ({
            date: s.startsAt.toISOString().slice(0, 10),
            durationMinutes: s.durationMinutes,
            exercises: s.exercises,
        })),
    };
    return llmShape.parse(JSON.parse(await askModel(SYSTEM, JSON.stringify(payload))));
}

export async function nextWorkout(customer: AuthUser) {
    const profile = await profileQueries.get(pool, customer.id);
    if (!profile) throw unprocessable("PROFILE_REQUIRED", "Fill in your fitness profile first.");
    const history = await profileQueries.recentSessions(pool, customer.id, HISTORY_LENGTH);

    if (config.openrouterApiKey && config.openrouterModel) {
        const started = Date.now();
        try {
            const recommendation = await askLlm(profile, history);
            log.info("llm.call", {
                customerId: customer.id,
                model: config.openrouterModel,
                ms: Date.now() - started,
                result: "ok",
            });
            return { engine: "llm" as const, model: config.openrouterModel, recommendation };
        } catch (err) {
            // Any failure (timeout, HTTP error, bad JSON) falls back to the rules. The error text is not logged
            // in full because it may echo parts of the request.
            log.warn("llm.call", {
                customerId: customer.id,
                model: config.openrouterModel,
                ms: Date.now() - started,
                result: "fallback",
                reason: err instanceof Error ? err.name : "unknown",
            });
        }
    }
    return { engine: "rules" as const, model: null, recommendation: recommendByRules(profile, history) };
}
