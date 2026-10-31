import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["social-support-local.spec.ts", "mobile-tables-local.spec.ts"],
  workers: 1,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
});
