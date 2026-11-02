import { mkdirSync, writeFileSync } from 'node:fs';
// Never serialize Playwright errors/requests: they may contain credentials or tokens.
function safeDiagnostic(message = '') {
  const value = String(message).replace(/\x1b\[[0-9;]*m/g, '');
  const auth = value.match(/Connexion fictive refusée \((\d{3})\)/);
  if (auth) return `firebase-auth-http-${auth[1]}`;
  if (/fetch failed/i.test(value)) return 'network-fetch-failed';
  if (/Timeout/i.test(value)) return 'timeout';
  if (/ENOENT/.test(value)) return 'file-not-found';
  const storage = value.match(/storage\/[a-z-]+/);
  if (storage) return storage[0];
  const firebase = value.match(/auth\/[a-z-]+/);
  if (firebase) return firebase[0];
  return 'unclassified';
}
export default class Reporter {
  rows = [];
  onTestEnd(test, result) {
    const errors = (result.errors || []).map(error => ({
      // Preserve only fixed diagnostic categories and source coordinates, never payloads.
      category: /ENOENT/.test(error.message || '') ? 'file-not-found'
        : /Timeout/.test(error.message || '') ? 'timeout' : 'assertion-or-runtime-error',
      diagnostic: safeDiagnostic(error.message),
      // HTTP status assertions contain no account, fixture, request or secret data.
      httpStatus: (() => {
        const match = (error.message || '').replace(/\x1b\[[0-9;]*m/g, '').match(/Expected:\s*(\d{3})\s*Received:\s*(\d{3})/);
        return match ? { expected: Number(match[1]), received: Number(match[2]) } : undefined;
      })(),
      source: `${error.stack || ''}\n${error.message || ''}`.split('\n').filter(line => /section-admin-staging\.spec\.mjs:\d+|sectionStagingFixture\.mjs:\d+/.test(line)).map(line => line.match(/(?:section-admin-staging\.spec|sectionStagingFixture)\.mjs:\d+:\d+/)?.[0]).filter(Boolean),
    }));
    this.rows.push({ title: test.title, status: result.status, errors }); console.log(`${result.status}: ${test.title}`);
  }
  onEnd(result) { mkdirSync('test-results', { recursive: true }); writeFileSync('test-results/section-staging-results.json', JSON.stringify({ status: result.status, tests: this.rows }, null, 2)); }
}
