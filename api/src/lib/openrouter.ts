import { config } from "../config/index.js";

// Minimal OpenRouter chat call. Returns the model's text, or throws (caller falls back to rules).
export async function askModel(system: string, user: string): Promise<string> {
    if (!config.openrouterApiKey || !config.openrouterModel) throw new Error("LLM not configured");
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.openrouterApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: config.openrouterModel,
            temperature: 0.3,
            max_tokens: 700,
            response_format: { type: "json_object" },
            // Reasoning models otherwise spend the whole token budget thinking and return empty content.
            reasoning: { enabled: false },
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
        }),
        signal: AbortSignal.timeout(config.llmTimeoutMs),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("LLM empty response");
    return text;
}
