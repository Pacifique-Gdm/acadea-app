import { mkdirSync, writeFileSync } from 'node:fs';
// Never serialize Playwright errors/requests: they may contain credentials or tokens.
export default class Reporter {
  rows = [];
  onTestEnd(test, result) {
    const errors = (result.errors || []).map(error => ({
      // Preserve only fixed diagnostic categories and source coordinates, never payloads.
      category: /ENOENT/.test(error.message || '') ? 'file-not-found'
        : /Timeout/.test(error.message || '') ? 'timeout' : 'assertion-or-runtime-error',
      source: (error.stack || '').split('\n').filter(line => /section-admin-staging\.spec\.mjs:\d+|sectionStagingFixture\.mjs:\d+/.test(line)).map(line => line.match(/(?:section-admin-staging\.spec|sectionStagingFixture)\.mjs:\d+:\d+/)?.[0]).filter(Boolean),
    }));
    this.rows.push({ title: test.title, status: result.status, errors }); console.log(`${result.status}: ${test.title}`);
  }
  onEnd(result) { mkdirSync('test-results', { recursive: true }); writeFileSync('test-results/section-staging-results.json', JSON.stringify({ status: result.status, tests: this.rows }, null, 2)); }
}
