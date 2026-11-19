import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { services } from './socialFinanceStagingFixture.mjs';
import { deleteOrphanSubdocuments, fixtureLeftovers, purgeStagingFixture } from './stagingFixturePurge.mjs';

// Reprise après une interruption : effacement complet de ce que cette recette exacte a créé
// (écoles, documents, sous-documents, signaux, comptes), sans rien chercher hors de son manifeste.
const path = 'diagnostics/fee-allocation-hosted/manifest.json';
const manifest = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'acadea-staging');
assert.equal(manifest.projectId, 'acadea-staging');
assert.match(manifest.tag, /^e2e-allocation-[a-f0-9]{32}$/);
assert.ok(manifest.schools.every(id => ['-a', '-b', '-inactive', '-volume', '-annual'].some(suffix => id === manifest.tag + suffix)));
assert.ok(manifest.users.every(u => u.uid.startsWith(manifest.tag + '-') && u.email === `${u.uid}@example.invalid`));
const s = services();
try {
  const report = await purgeStagingFixture({ db: s.db, auth: s.auth, bucket: s.bucket, projectId: manifest.projectId, tag: manifest.tag, extraUids: manifest.users.map(u => u.uid) });
  report.documents += await deleteOrphanSubdocuments(s.db, manifest.schools);
  assert.deepEqual(await fixtureLeftovers(s.db, manifest.tag, manifest.schools), []);
  manifest.retained = {}; manifest.retired = true; manifest.deleted = true;
  manifest.closedAt = new Date().toISOString(); manifest.recovery = report;
  writeFileSync(path, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ projectId: manifest.projectId, retired: true, deleted: true, ...report }));
} finally { await s.close(); }
