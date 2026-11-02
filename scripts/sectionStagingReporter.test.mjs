import { test } from 'node:test';
import assert from 'node:assert/strict';
import Reporter from '../e2e/support/sectionStagingReporter.mjs';

test('section Staging reporter retains safe diagnostics without credentials', () => {
  const reporter = new Reporter();
  reporter.onTestEnd({ title: 'fixture' }, { status: 'failed', errors: [{
    message: 'Connexion fictive refusée (403). Bearer forbidden-token',
    stack: 'at section-admin-staging.spec.mjs:45:92',
  }] });
  assert.deepEqual(reporter.rows[0].errors[0], {
    category: 'assertion-or-runtime-error',
    diagnostic: 'firebase-auth-http-403',
    httpStatus: undefined,
    source: ['section-admin-staging.spec.mjs:45:92'],
  });
  assert.equal(JSON.stringify(reporter.rows).includes('forbidden-token'), false);
});
