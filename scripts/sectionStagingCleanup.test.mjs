import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePlan, prepare, cleanup, manifest } from './sectionStagingFixture.mjs';

function memoryBackend() {
  const data = new Map([['schools/existing', { id: 'existing', name: 'Do not touch' }]]), users = new Map(), objects = new Map();
  const missing = () => { throw Object.assign(new Error('absent'), { code: 'auth/user-not-found' }); };
  const doc = path => ({ path,
    async get() { return { exists: data.has(path), id: path.split('/')[1], ref: doc(path), data: () => data.get(path), updateTime: 1 }; },
    async create(value) { if (data.has(path)) throw new Error('collision'); data.set(path, value); },
    async delete(options) { assert.equal(options.lastUpdateTime, 1); data.delete(path); },
    async listCollections() { return []; },
  });
  const collection = id => ({
    where(field, op, value) { assert.equal(op, '=='); return { async get() {
      const docs = await Promise.all([...data.keys()].filter(path => path.startsWith(`${id}/`) && data.get(path)[field] === value).map(path => doc(path).get()));
      return { docs, empty: !docs.length };
    } }; },
  });
  return { data, users, objects, db: { doc, collection, async listCollections() { return [...new Set([...data.keys()].map(p => p.split('/')[0]))].map(collection); } },
    auth: { async getUser(uid) { return users.get(uid) ?? missing(); }, async createUser(user) { if (users.has(user.uid)) throw new Error('collision'); users.set(user.uid, user); }, async setCustomUserClaims() {}, async deleteUser(uid) { users.delete(uid); } },
    bucket: { async getFiles({ prefix }) { return [[...objects.keys()].filter(k => k.startsWith(prefix)).map(name => ({ async getMetadata() { return [{ generation: '1' }]; }, async delete(o) { assert.equal(o.ifGenerationMatch, '1'); objects.delete(name); } }))]; } },
  };
}
async function isolated(fn) {
  const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'acadea-fixture-contract-'));
  process.chdir(dir); process.env.ACADEA_E2E_PASSWORD = 'test-only-not-an-account-'.repeat(3);
  try { await fn(); } finally { process.chdir(cwd); delete process.env.ACADEA_E2E_PASSWORD; rmSync(dir, { recursive: true, force: true }); }
}
test('cycle complet, créations serveur, fichiers et nettoyage idempotent sans toucher aux tiers', () => isolated(async () => {
  const s = memoryBackend(); await preparePlan(s); await prepare(s); const m = manifest();
  s.data.set('payments/generated', { schoolId: m.schools[0], amount: 10 });
  s.objects.set(`messages/${m.schools[0]}/conversation/message/file.pdf`, true);
  s.objects.set('messages/existing/private.pdf', true);
  await cleanup(s); await cleanup(s);
  assert.deepEqual([...s.data.keys()], ['schools/existing']); assert.equal(s.users.size, 0);
  assert.deepEqual([...s.objects.keys()], ['messages/existing/private.pdf']); assert.equal(manifest().cleaned, true);
  assert.ok(!readFileSync('test-results/section-staging-manifest.json', 'utf8').includes(process.env.ACADEA_E2E_PASSWORD));
}));
test('nettoyage après création interrompue des comptes', () => isolated(async () => {
  const s = memoryBackend(); await preparePlan(s); const create = s.auth.createUser; let count = 0;
  s.auth.createUser = async u => { if (++count === 3) throw new Error('interruption simulée'); await create(u); };
  await assert.rejects(prepare(s)); await cleanup(s);
  assert.deepEqual([...s.data.keys()], ['schools/existing']); assert.equal(s.users.size, 0);
}));
test('arrêt sur document ambigu sans suppression de celui-ci', () => isolated(async () => {
  const s = memoryBackend(); await preparePlan(s); await prepare(s); const m = manifest();
  const path = m.documents[0].path; s.data.set(path, { id: 'foreign', schoolId: 'existing' });
  await assert.rejects(cleanup(s), /non attribuable/); assert.equal(s.data.get(path).id, 'foreign');
}));
