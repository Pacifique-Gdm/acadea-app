import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["money-input-amendments.spec.ts", "social-support-local.spec.ts"],
  workers: 1,
  timeout: 60000,
  reporter: "line",
  use: { screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
