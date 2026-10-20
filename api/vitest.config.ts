import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        fileParallelism: false, // files share one database; each file builds its own zone, but run them one at a time
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
