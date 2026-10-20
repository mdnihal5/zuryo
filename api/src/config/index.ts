import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: z.stringbool().default(false),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_EXPIRES_IN_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    BCRYPT_COST: z.coerce.number().int().min(4).max(14).default(12),
    CORS_ORIGINS: z.string().default("http://localhost:5173"),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    RATE_LIMIT_ENABLED: z.stringbool().default(true),
    SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(30),
    SWEEP_ENABLED: z.stringbool().default(true),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    OPENROUTER_MODEL: z.string().min(1).optional(),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(500).default(8000),
    MOCKPAY_ENABLED: z.stringbool().default(true),
    MOCKPAY_WEBHOOK_SECRET: z.string().min(16, "MOCKPAY_WEBHOOK_SECRET must be at least 16 characters").optional(),
    MOCKPAY_WEBHOOK_DELAY_MS: z.coerce.number().int().min(0).default(1500),
    PUBLIC_API_URL: z.url().optional(),
    CLIENT_URL: z.url().optional(),
    SEED_ALLOW_PRODUCTION: z.stringbool().default(false),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    // Names the bad variables only; never prints values (they may be secrets).
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
}
const env = parsed.data;
if (env.NODE_ENV === "production" && !env.MOCKPAY_WEBHOOK_SECRET) {
    throw new Error("Invalid environment:\n  MOCKPAY_WEBHOOK_SECRET: required in production");
}
const corsOrigins = env.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    seedAllowProduction: env.SEED_ALLOW_PRODUCTION,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresInHours: env.JWT_EXPIRES_IN_HOURS,
    bcryptCost: env.BCRYPT_COST,
    corsOrigins,
    trustProxy: env.TRUST_PROXY,
    rateLimitEnabled: env.RATE_LIMIT_ENABLED,
    sweepIntervalSeconds: env.SWEEP_INTERVAL_SECONDS,
    sweepEnabled: env.SWEEP_ENABLED,
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterModel: env.OPENROUTER_MODEL,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    mockpayEnabled: env.MOCKPAY_ENABLED,
    webhookSecret: env.MOCKPAY_WEBHOOK_SECRET ?? "dev-only-mockpay-webhook-secret",
    mockpayWebhookDelayMs: env.MOCKPAY_WEBHOOK_DELAY_MS,
    // Where MockPay posts its webhook, and where the hosted checkout page lives (the web client).
    publicApiUrl: (env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, ""),
    clientUrl: (env.CLIENT_URL ?? corsOrigins[0] ?? "http://localhost:5173").replace(/\/$/, ""),
    logLevel: env.LOG_LEVEL,
});
