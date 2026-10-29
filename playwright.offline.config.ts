import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "offline-queue-local.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { ...devices["Desktop Chrome"], trace: "off", screenshot: "off", video: "off" },
});
