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
      exclude: ["src/index.ts"], // bootstrap: side-effectful entrypoint, run via smoke test
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
    },
  },
});
