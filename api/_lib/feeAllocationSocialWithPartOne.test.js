import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeAllocationFixture } from './feeAllocationLifecycle.test.js';
import { manageFeeAllocationLifecycle } from './feeAllocationLifecycle.js';
import { manageFeeAllocationPhase1 } from './feeAllocationPhase1.js';
import { manageFeeAllocationPhase2 } from './feeAllocationPhase2.js';
import { feeAllocationConfigId } from './feeAllocationPhase1.js';
import { executeFinancialOperation } from './financialTransactions.js';
import { reconcileFixture } from './feeAllocationTestHelpers.js';

// Version 1.19.0 : « Ajouter une répartition » montre la partie des élèves normaux et, dessous, celle des cas sociaux.
// Les deux parties sont publiées EN MÊME TEMPS ; si elles diffèrent, la phrase « PUBLIER LA PARTIE DEUX » est exigée.
const admin = { uid: 'admin', role: 'school_admin', schoolId: 'school' }, cashier = { uid: 'cashier', role: 'cashier', schoolId: 'school' };
const at = '2026-11-13T10:00:00.000Z', publication = '2026-11-13T12:00:00.000Z';
let sequence = 0;
const lifecycle = (db, action, extra = {}, now = at) => manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action, requestId: `social-p1-${++sequence}-request`, ...extra } });
const A = 'a'.repeat(32), B = 'b'.repeat(32);
async function liveSchool() {
  const db = completeAllocationFixture();
  await lifecycle(db, 'publish-configuration', { versionId: 'version' });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle(db, 'prepare-opening', { cashCountMinor: 0, lines: [{ rubricId: A, amountMinor: 0 }], confirmation: 'RAPPROCHER LA CAISSE' });
  await lifecycle(db, 'approve-opening', { openingId: opening.openingId, confirmation: 'APPROUVER LE RAPPROCHEMENT' });
  await lifecycle(db, 'activate', { openingId: opening.openingId, confirmation: 'ACTIVER LA REPARTITION FICTIVE' });
  db.records.set('feeTypes/new-fee', { ...db.records.get('feeTypes/fee'), id: 'new-fee', name: 'Nouveau frais', createdAt: '2026-09-01T00:00:00.000Z' });
  return db;
}
const rubrics = [{ id: B, name: 'Nouvelle rubrique', mode: 'percent', basisPoints: 5000 }];
async function prepare(db, socialRubrics) {
  await manageFeeAllocationPhase2({ db, caller: admin, body: { action: 'save-drafts', schoolYearId: 'year', baseFeeTypeId: 'new-fee', targets: [{ feeTypeId: 'new-fee', expectedRevision: 0 }],
    rubrics, ...(socialRubrics ? { socialRubrics } : {}), requestId: `prepare-social-draft-${++sequence}` } });
  return (await manageFeeAllocationPhase1({ db, caller: admin, body: { action: 'prepare-version', feeTypeId: 'new-fee', expectedRevision: 1, requestId: `prepare-social-version-${++sequence}` } })).version;
}
const config = (db) => db.records.get(`feeAllocationConfigs/${feeAllocationConfigId('school', 'year', 'new-fee')}`);
const socials = (db) => [...db.records].filter(([p]) => p.startsWith('feeAllocationSocialVersions/')).map(([, d]) => d);
afterEach(() => vi.unstubAllEnvs());

describe('version 1.19.0 : partie des cas sociaux saisie avec la partie 1', () => {
  it('différente : refusée sans la phrase, puis les deux parties publiées ensemble', async () => {
    const db = await liveSchool();
    const version = await prepare(db, [{ id: B, mode: 'percent', basisPoints: 2000 }]);
    expect(version.socialRubrics).toEqual([{ id: B, mode: 'percent', basisPoints: 2000 }]);
    const before = structuredClone([...db.records]);
    await expect(lifecycle(db, 'publish-configuration', { versionId: version.id }, publication)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('PUBLIER LA PARTIE DEUX') });
    await expect(lifecycle(db, 'publish-configuration', { versionId: version.id, confirmation: 'publier la partie deux' }, publication)).rejects.toMatchObject({ status: 400 });
    expect([...db.records]).toEqual(before);
    const result = await lifecycle(db, 'publish-configuration', { versionId: version.id, confirmation: 'PUBLIER LA PARTIE DEUX' }, publication);
    expect(config(db)).toMatchObject({ currentVersionId: version.id, socialVersionId: result.socialVersionId });
    expect(socials(db)).toEqual([expect.objectContaining({ partOneVersionId: version.id, status: 'published', effectiveFrom: publication,
      rubrics: [expect.objectContaining({ id: B, mode: 'percent', basisPoints: 2000 })] })]);
  });
  it('identique à la partie 1 : aucune partie 2, aucune phrase demandée', async () => {
    const db = await liveSchool();
    const version = await prepare(db, [{ id: B, mode: 'percent', basisPoints: 5000 }]);
    expect(version.socialRubrics).toBeUndefined();
    await lifecycle(db, 'publish-configuration', { versionId: version.id }, publication);
    expect(config(db).socialVersionId).toBeUndefined(); expect(socials(db)).toHaveLength(0);
  });
  it('sans partie des cas sociaux (école sans cas social) : comportement inchangé', async () => {
    const db = await liveSchool();
    const version = await prepare(db);
    await lifecycle(db, 'publish-configuration', { versionId: version.id }, publication);
    expect(config(db).socialVersionId).toBeUndefined();
  });
  it('rubriques différentes de la partie 1 ou total au-dessus de 100 % : refus clair dès l’enregistrement', async () => {
    const db = await liveSchool();
    await expect(prepare(db, [{ id: A, mode: 'percent', basisPoints: 2000 }])).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Cas sociaux') });
    await expect(prepare(db, [{ id: B, mode: 'percent', basisPoints: 12000 }])).rejects.toMatchObject({ status: 400 });
  });
  it('un cas social qui paie après la publication suit la partie 2 publiée avec la partie 1', async () => {
    const db = await liveSchool();
    const version = await prepare(db, [{ id: B, mode: 'percent', basisPoints: 2000 }]);
    await lifecycle(db, 'publish-configuration', { versionId: version.id, confirmation: 'PUBLIER LA PARTIE DEUX' }, publication);
    db.records.get('students/student').financialSupport = { d: { id: 'd', schoolYearId: 'year', lines: { 'new-fee': { reductionMinor: 4000 } } } };
    await executeFinancialOperation({ db, caller: cashier, now: '2026-11-13T12:30:00.000Z', body: {
      action: 'create-payment', schoolYearId: 'year', studentId: 'student', feeTypeId: 'new-fee', amount: 10, clientRequestId: 'social-after-both-parts', proposedAt: '2026-11-13T12:20:00.000Z' } });
    const movement = [...db.records.values()].find((v) => v.sourceType === 'payment' && v.feeTypeId === 'new-fee');
    expect(movement.socialCase).toBe(true);
    // 20 % de ce qu'il paie vraiment va à la rubrique ; le reste dans « Non affecté ».
    expect(movement.lines).toEqual(expect.arrayContaining([{ rubricId: B, amountMinor: 200 }, { rubricId: 'UNALLOCATED', amountMinor: 800 }]));
  });
});
