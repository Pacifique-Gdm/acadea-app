import { defineConfig } from '@playwright/test';
import { guard } from './scripts/sectionStagingPlan.mjs';
guard(process.env);
export default defineConfig({
  outputDir: './test-results/playwright-section-output',
  testDir: './e2e', testMatch: 'section-admin-staging.spec.mjs', workers: 1, retries: 0,
  timeout: 300000, forbidOnly: true, reporter: './e2e/support/sectionStagingReporter.mjs',
  use: { baseURL: process.env.ACADEA_SECTION_PREVIEW_URL, trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block' },
});
