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
    },
    include: ["tests/**/*.test.ts"],
  },
});
