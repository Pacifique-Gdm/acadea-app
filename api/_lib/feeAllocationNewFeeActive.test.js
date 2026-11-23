import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeAllocationFixture } from './feeAllocationLifecycle.test.js';
import { manageFeeAllocationLifecycle } from './feeAllocationLifecycle.js';
import { manageFeeAllocationPhase1 } from './feeAllocationPhase1.js';
import { manageFeeAllocationPhase2 } from './feeAllocationPhase2.js';
import { readAllocationActivation } from './feeAllocationActivationView.js';
import { reconcileFixture } from './feeAllocationTestHelpers.js';

// Correction 1.20.1 : quand la répartition est active, la lecture de l'écran renvoyait « versions: [] ».
// « Publier le nouveau frais » n'apparaissait donc jamais pour un frais ajouté en milieu d'année.
const admin = { uid: 'admin', role: 'school_admin', schoolId: 'school' };
const at = '2026-11-13T10:00:00.000Z';
let sequence = 0;
const lifecycle = (db, action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `new-fee-active-${++sequence}-request`, ...extra } });
afterEach(() => vi.unstubAllEnvs());

async function activeSchoolWithPreparedNewFee() {
  const db = completeAllocationFixture();
  await lifecycle(db, 'publish-configuration', { versionId: 'version' });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle(db, 'prepare-opening', { cashCountMinor: 0, lines: [{ rubricId: 'a'.repeat(32), amountMinor: 0 }], confirmation: 'RAPPROCHER LA CAISSE' });
  await lifecycle(db, 'approve-opening', { openingId: opening.openingId, confirmation: 'APPROUVER LE RAPPROCHEMENT' });
  await lifecycle(db, 'activate', { openingId: opening.openingId, confirmation: 'ACTIVER LA REPARTITION FICTIVE' });
  db.records.set('feeTypes/new-fee', { ...db.records.get('feeTypes/fee'), id: 'new-fee', name: 'Nouveau frais', createdAt: '2026-09-01T00:00:00.000Z' });
  await manageFeeAllocationPhase2({ db, caller: admin, body: { action: 'save-drafts', schoolYearId: 'year', baseFeeTypeId: 'new-fee', targets: [{ feeTypeId: 'new-fee', expectedRevision: 0 }],
    rubrics: [{ id: 'b'.repeat(32), name: 'Nouvelle rubrique', mode: 'percent', basisPoints: 5000 }], requestId: 'new-fee-active-draft' } });
  const { version } = await manageFeeAllocationPhase1({ db, caller: admin, body: { action: 'prepare-version', feeTypeId: 'new-fee', expectedRevision: 1, requestId: 'new-fee-active-version' } });
  return { db, version };
}

describe('correction 1.20.1 : nouveau frais quand la répartition est active', () => {
  it("la lecture de l'écran renvoie la version préparée du nouveau frais (et non une liste vide)", async () => {
    const { db, version } = await activeSchoolWithPreparedNewFee();
    const view = await readAllocationActivation({ db, caller: admin, now: at, body: { action: 'get-activation' } });
    expect(view.status).toBe('ACTIVE');
    expect(view.versions).toEqual(expect.arrayContaining([{ id: version.id, configId: version.configId, feeTypeId: 'new-fee', version: 1, status: 'prepared' }]));
    // Ni rubriques ni montants dans cette lecture.
    expect(JSON.stringify(view.versions)).not.toContain('basisPoints');
  });
  it('la version lue est bien publiable : le nouveau frais est réparti', async () => {
    const { db, version } = await activeSchoolWithPreparedNewFee();
    const view = await readAllocationActivation({ db, caller: admin, now: at, body: { action: 'get-activation' } });
    const prepared = view.versions.find((v) => v.feeTypeId === 'new-fee' && v.status === 'prepared');
    await lifecycle(db, 'publish-configuration', { versionId: prepared.id });
    expect(db.records.get(`feeAllocationVersions/${version.id}`)).toMatchObject({ status: 'published', publicationMode: 'new-fee-after-activation' });
  });
});
