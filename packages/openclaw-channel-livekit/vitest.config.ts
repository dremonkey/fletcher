import { defineConfig } from "vitest/config";
import { resolve } from "path";

const packageDir = resolve(__dirname);

export default defineConfig({
  test: {
    root: packageDir,
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30000,
    pool: "forks",
    globals: true,
  },
});
