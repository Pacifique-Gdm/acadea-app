import { defineConfig, devices } from "@playwright/test";
import { config as loadEnvironment } from "dotenv";
import { assertSafeE2EEnvironment } from "./e2e/support/environment";

loadEnvironment({ path: ".env.local", quiet: true });

const environment = assertSafeE2EEnvironment(process.env);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "line",
  use: {
    baseURL: environment.baseUrl,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
