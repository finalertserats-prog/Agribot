import { defineConfig } from "vitest/config";
import os from "os";
import path from "path";

export default defineConfig({
  test: {
    // config/index.ts validates env at import and exits if GEMINI_API_KEY is
    // missing — provide a dummy so modules import cleanly under test.
    // DATA_DIR points at an isolated temp dir so tests never touch real app data.
    env: {
      GEMINI_API_KEY: "test-key-for-vitest",
      DATA_DIR: path.join(os.tmpdir(), "agrifriend-test-data"),
      LOG_LEVEL: "fatal", // quiet pino during tests (error-path tests log a lot)
    },
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Side-effectful entrypoints / thin I/O wiring — verified by the live smoke
      // tests (bot boot + Ops Copilot self-heal), not by unit tests. The pure
      // logic they orchestrate (health.ts, metrics.ts) IS unit-tested.
      exclude: [
        "src/index.ts",
        "src/ops/copilot.ts",
        "src/ops/heartbeat.ts",
        "src/ops/notifier.ts",
      ],
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
    },
  },
});
