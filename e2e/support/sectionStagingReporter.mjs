import { mkdirSync, writeFileSync } from 'node:fs';
// Never serialize Playwright errors/requests: they may contain credentials or tokens.
export default class Reporter {
  rows = [];
  onTestEnd(test, result) { this.rows.push({ title: test.title, status: result.status }); console.log(`${result.status}: ${test.title}`); }
  onEnd(result) { mkdirSync('test-results', { recursive: true }); writeFileSync('test-results/section-staging-results.json', JSON.stringify({ status: result.status, tests: this.rows }, null, 2)); }
}
