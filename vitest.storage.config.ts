import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/storage/**/*.rules.ts"],
    fileParallelism: false,
  },
});
