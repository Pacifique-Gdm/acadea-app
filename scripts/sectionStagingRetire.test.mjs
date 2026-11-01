import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from './sectionStagingPlan.mjs';
import { retire } from './sectionStagingRetire.mjs';

function fixture() {
  const m = plan();
  const data = new Map(m.documents.map(d => [d.path, { ...d.data }]));
  data.set('schools/existing', { id: 'existing', active: true });
  const accounts = new Map(Object.values(m.users).map(u => [u.uid, { ...u, disabled: false, customClaims: { role: u.role } }]));
  const writes = [], revoked = new Set();
  const s = { db: { doc: path => ({
    async get() { return { exists: data.has(path), data: () => data.get(path), updateTime: 1 }; },
    async update(value, precondition) { assert.equal(precondition.lastUpdateTime, 1); writes.push(path); Object.assign(data.get(path), value); },
  }) }, auth: {
    async getUser(uid) { if (!accounts.has(uid)) throw Object.assign(new Error('absent'), { code: 'auth/user-not-found' }); return accounts.get(uid); },
    async updateUser(uid, patch) { writes.push(uid); Object.assign(accounts.get(uid), patch); },
    async setCustomUserClaims(uid, claims) { accounts.get(uid).customClaims = claims; },
    async revokeRefreshTokens(uid) { revoked.add(uid); },
  } };
  return { s, m, data, accounts, writes, revoked };
}
test('clôture sans suppression, conservation financière et idempotence', async () => {
  const f = fixture(); const before = JSON.stringify([...f.data].filter(([p]) => p.startsWith('payments/')));
  const result = await retire(f.s, f.m); await retire(f.s, f.m);
  assert.equal(result.cleaned, false); assert.equal(result.retained, true);
  assert.equal(f.revoked.size, Object.keys(f.m.users).length);
  assert.ok([...f.accounts.values()].every(u => u.disabled && !Object.keys(u.customClaims).length));
  assert.equal(f.data.get('schools/existing').active, true);
  assert.equal(JSON.stringify([...f.data].filter(([p]) => p.startsWith('payments/'))), before);
});
test('création interrompue : comptes et documents manquants tolérés', async () => {
  const f = fixture(); f.accounts.clear(); f.data.delete(`schools/${f.m.schools[1]}`);
  assert.equal((await retire(f.s, f.m)).disabledAccounts, 0);
});
test('compte ambigu : aucune mutation', async () => {
  const f = fixture(); f.accounts.values().next().value.email = 'someone-else@example.invalid';
  await assert.rejects(retire(f.s, f.m), /Compte ambigu/); assert.equal(f.writes.length, 0);
});
test('document ambigu : aucune mutation', async () => {
  const f = fixture(); f.data.get(`schools/${f.m.schools[0]}`).fixtureId = 'foreign';
  await assert.rejects(retire(f.s, f.m), /Document ambigu/); assert.equal(f.writes.length, 0);
});
test('projet autre que Staging refusé avant toute mutation', async () => {
  const f = fixture(); f.m.projectId = 'acadea-production';
  await assert.rejects(retire(f.s, f.m), /Manifeste/); assert.equal(f.writes.length, 0);
});
test('échec de révocation non masqué, réessai possible', async () => {
  const f = fixture(); const revoke = f.s.auth.revokeRefreshTokens;
  f.s.auth.revokeRefreshTokens = async () => { throw new Error('network'); };
  await assert.rejects(retire(f.s, f.m), /network/);
  f.s.auth.revokeRefreshTokens = revoke; assert.equal((await retire(f.s, f.m)).retired, true);
});
