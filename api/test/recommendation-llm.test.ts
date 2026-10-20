import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Config is read once at import, so the LLM variables are set before anything is imported.
process.env.OPENROUTER_API_KEY = "test-key-not-real";
process.env.OPENROUTER_MODEL = "test/model";

// Stand-in for the network: the real askModel() runs, only fetch is replaced.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (content: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
});

const { api, bearer, closeAll, tokenFor } = await import("./helpers.js");
afterAll(closeAll);

const good = {
    title: "Upper body",
    focus: ["upper"],
    durationMinutes: 60,
    intensity: "moderate",
    exercises: [
        { name: "Push-ups", detail: "3x10" },
        { name: "Rows", detail: "3x12" },
    ],
    reasoning: ["Because"],
};
const get = async () =>
    api.get("/v1/recommendations/next-workout").set(bearer(await tokenFor("asha@zuryo.test", "Demo@12345")));

describe("LLM recommendation path", () => {
    beforeEach(() => fetchMock.mockReset());

    it("uses the model's answer when it is valid, and sends no personal identifiers", async () => {
        fetchMock.mockResolvedValue(reply(JSON.stringify(good)));
        const res = await get();
        expect(res.body.data).toMatchObject({ engine: "llm", model: "test/model" });
        const sent = String(fetchMock.mock.calls[0][1].body);
        expect(sent).not.toMatch(/asha|zuryo\.test|Rao/i);
        expect(sent).toContain("weightKg");
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key-not-real");
    });

    it("falls back to the rules when the provider returns an error", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        const res = await get();
        expect(res.body.data.engine).toBe("rules");
    });

    it("falls back to the rules when the model returns something that is not the expected JSON", async () => {
        fetchMock.mockResolvedValue(reply("sure, here is a plan!"));
        expect((await get()).body.data.engine).toBe("rules");
        fetchMock.mockResolvedValue(reply(JSON.stringify({ ...good, intensity: "extreme" })));
        expect((await get()).body.data.engine).toBe("rules");
    });
});
