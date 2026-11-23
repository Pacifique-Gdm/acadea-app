import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeAllocationFixture } from './feeAllocationLifecycle.test.js';
import { manageFeeAllocationLifecycle } from './feeAllocationLifecycle.js';
import { feeAllocationConfigId, manageFeeAllocationPhase1 } from './feeAllocationPhase1.js';
import { manageFeeAllocationPhase2 } from './feeAllocationPhase2.js';
import { manageSocialPart } from './feeAllocationSocialPart.js';
import { manageFeeAllocationSharing } from './feeAllocationSharing.js';
import { withoutSocialForecast } from './feeAllocationSocialPrivacy.js';
import { reconcileFixture } from './feeAllocationTestHelpers.js';

// Règle du propriétaire (23/11) : SEUL l'Administrateur de l'école a accès à la « Partie 2 — cas sociaux ».
// Lecture comme publication : le Caissier, la Coordination, la Sous-coordination et le personnel partagé sont refusés (403),
// et les règles de la partie 2 ne sortent jamais du serveur dans leurs autres lectures.
const admin = { uid: 'admin', role: 'school_admin', schoolId: 'school' };
const legacyAdmin = { uid: 'legacy', role: 'admin', schoolId: 'school' };
const cashier = { uid: 'cashier', role: 'cashier', schoolId: 'school' };
const coordination = { uid: 'coord', role: 'coordination_admin', coordinationId: 'coord' };
const subCoordination = { uid: 'sub', role: 'sub_coordination_admin', coordinationId: 'coord', subCoordinationId: 'sub' };
const teacher = { uid: 'teacher', role: 'teacher', schoolId: 'school' };
const at = '2026-11-13T10:00:00.000Z', publication = '2026-11-13T12:00:00.000Z';
const A = 'a'.repeat(32), B = 'b'.repeat(32);
let sequence = 0;
const lifecycle = (db, action, extra = {}, now = at) => manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action, requestId: `social-access-${++sequence}-request`, ...extra } });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
// Le périmètre de recette de la répartition dure 24 h : les lectures de l'espace de travail se font le jour de la publication.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-13T13:00:00.000Z')); });

/** École active, un frais avec une partie 2 publiée (différente de la partie 1), et un compte de chaque rôle. */
async function schoolWithSocialPart() {
  const db = completeAllocationFixture();
  await lifecycle(db, 'publish-configuration', { versionId: 'version' });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle(db, 'prepare-opening', { cashCountMinor: 0, lines: [{ rubricId: A, amountMinor: 0 }], confirmation: 'RAPPROCHER LA CAISSE' });
  await lifecycle(db, 'approve-opening', { openingId: opening.openingId, confirmation: 'APPROUVER LE RAPPROCHEMENT' });
  await lifecycle(db, 'activate', { openingId: opening.openingId, confirmation: 'ACTIVER LA REPARTITION FICTIVE' });
  db.records.set('feeTypes/new-fee', { ...db.records.get('feeTypes/fee'), id: 'new-fee', name: 'Nouveau frais', createdAt: '2026-09-01T00:00:00.000Z' });
  await manageFeeAllocationPhase2({ db, caller: admin, body: { action: 'save-drafts', schoolYearId: 'year', baseFeeTypeId: 'new-fee', targets: [{ feeTypeId: 'new-fee', expectedRevision: 0 }],
    rubrics: [{ id: B, name: 'Nouvelle rubrique', mode: 'percent', basisPoints: 5000 }], socialRubrics: [{ id: B, mode: 'percent', basisPoints: 2000 }], requestId: `social-access-draft-${++sequence}` } });
  const { version } = await manageFeeAllocationPhase1({ db, caller: admin, body: { action: 'prepare-version', feeTypeId: 'new-fee', expectedRevision: 1, requestId: `social-access-version-${++sequence}` } });
  await lifecycle(db, 'publish-configuration', { versionId: version.id, confirmation: 'PUBLIER LA PARTIE DEUX' }, publication);
  db.records.set('schools/school', { ...db.records.get('schools/school'), activeCoordinationId: 'coord' });
  db.records.set('users/legacy', { ...legacyAdmin, active: true });
  db.records.set('users/coord', { role: 'coordination_admin', coordinationId: 'coord', active: true });
  db.records.set('users/sub', { role: 'sub_coordination_admin', coordinationId: 'coord', subCoordinationId: 'sub', active: true });
  db.records.set('coordinations/coord', { status: 'active' });
  db.records.set('coordinationSchools/coord__school', { active: true, schoolId: 'school' });
  db.records.set('subCoordinations/sub', { status: 'active', coordinationId: 'coord', coordinatorUserId: 'sub' });
  db.records.set('subCoordinationSchools/sub__school', { active: true, schoolId: 'school', coordinationId: 'coord' });
  // La nouvelle rubrique est partagée avec tout le personnel : l'Enseignant a donc accès à la répartition (lecture seule).
  db.records.set('feeAllocationShares/school__year', { schoolId: 'school', schoolYearId: 'year', rubrics: { [B]: { all: true, exceptUserIds: [] } } });
  return db;
}
const socialPart = (db, caller, action = 'get-social-parts') => manageSocialPart({ db, caller,
  body: { action, schoolId: 'school', ...(action === 'get-social-part' ? { feeTypeId: 'new-fee' } : {}) } });
const refused = { status: 403, code: 'permission-denied' };
/** Aucune trace de la partie 2 dans une réponse : ni ses règles, ni sa version, ni le nombre de cas sociaux. */
const expectNoSocialData = (response) => {
  const text = JSON.stringify(response);
  for (const key of ['socialRubrics', 'socialVersionId', 'socialStudentCount', 'hasSocialPart']) expect(text).not.toContain(`"${key}"`);
  for (const row of response.forecast?.rows ?? []) if (row.table === 2) for (const key of ['rubricShare', 'rubricMode', 'basisPoints']) expect(row).not.toHaveProperty(key);
};

describe('partie 2 (cas sociaux) : réservée à l’Administrateur de l’école', () => {
  it.each([['Administrateur', admin], ['ancien rôle admin', legacyAdmin]])('%s : lit la partie 2 d’un frais et de tous les frais', async (_label, caller) => {
    const db = await schoolWithSocialPart();
    const one = await socialPart(db, caller, 'get-social-part');
    expect(one.social).toMatchObject({ status: 'published', rubrics: [expect.objectContaining({ id: B, basisPoints: 2000 })] });
    const all = await socialPart(db, caller);
    expect(all.items.find((item) => item.feeTypeId === 'new-fee').social).toMatchObject({ status: 'published' });
  });

  it.each([['Caissier', cashier], ['Coordination', coordination], ['Sous-coordination', subCoordination], ['personnel partagé', teacher]])(
    '%s : lecture de la partie 2 refusée (403), d’un frais comme de tous les frais', async (_label, caller) => {
      const db = await schoolWithSocialPart();
      await expect(socialPart(db, caller, 'get-social-part')).rejects.toMatchObject(refused);
      await expect(socialPart(db, caller)).rejects.toMatchObject(refused);
    });

  it.each([['Caissier', cashier], ['Coordination', coordination], ['Sous-coordination', subCoordination], ['personnel partagé', teacher]])(
    '%s : publication de la partie 2 refusée (403), rien n’est écrit', async (_label, caller) => {
      const db = await schoolWithSocialPart();
      const before = structuredClone([...db.records]);
      await expect(manageSocialPart({ db, caller, body: { action: 'publish-social-parts', requestId: 'social-access-publish-1', confirmation: 'PUBLIER LA PARTIE DEUX',
        items: [{ feeTypeId: 'new-fee', expectedPartOneVersionId: 'x', expectedSocialVersionId: null, rubrics: [] }] } })).rejects.toMatchObject(refused);
      expect([...db.records]).toEqual(before);
    });
});

describe('les autres lectures ne laissent pas sortir la partie 2', () => {
  it('Administrateur : reçoit la partie 2 dans l’espace de travail et les versions', async () => {
    const db = await schoolWithSocialPart();
    const workspace = await manageFeeAllocationPhase2({ db, caller: admin, body: { action: 'get-workspace', schoolId: 'school' } });
    const config = workspace.configs.find((item) => item.feeTypeId === 'new-fee');
    expect(config.socialVersionId).toEqual(expect.any(String));
    expect(config.draft.socialRubrics).toEqual([expect.objectContaining({ id: B, basisPoints: 2000 })]);
    const { versions } = await manageFeeAllocationPhase1({ db, caller: admin, body: { action: 'list-versions', feeTypeId: 'new-fee' } });
    expect(versions.some((version) => version.socialRubrics?.length)).toBe(true);
  });

  it.each([['Caissier', cashier], ['Coordination', coordination], ['Sous-coordination', subCoordination]])(
    '%s : espace de travail, configurations et versions sans partie 2', async (_label, caller) => {
      const db = await schoolWithSocialPart();
      // La partie 2 est bien enregistrée : c'est la réponse qui la retire.
      expect(db.records.get(`feeAllocationConfigs/${feeAllocationConfigId('school', 'year', 'new-fee')}`).draft.socialRubrics).toHaveLength(1);
      const workspace = await manageFeeAllocationPhase2({ db, caller, body: { action: 'get-workspace', schoolId: 'school' } });
      expect(workspace.configs.some((item) => item.feeTypeId === 'new-fee' && item.currentVersionId)).toBe(true);
      expectNoSocialData(workspace);
      expectNoSocialData(await manageFeeAllocationPhase1({ db, caller, body: { action: 'list-configurations', schoolId: 'school' } }));
      expectNoSocialData(await manageFeeAllocationPhase1({ db, caller, body: { action: 'list-versions', schoolId: 'school', feeTypeId: 'new-fee' } }));
    });

  it('personnel partagé : son espace partagé ne contient aucune partie 2', async () => {
    const db = await schoolWithSocialPart();
    const shared = await manageFeeAllocationSharing({ db, caller: teacher, body: { action: 'get-shared-workspace', schoolId: 'school' } });
    expectNoSocialData(shared);
  });

  it('prévu : le tableau 2 garde ses montants mais perd ses pourcentages et sa version', () => {
    const forecast = { status: 'complete', socialStudentCount: 3, rows: [
      { table: 1, rubricId: B, amountMinor: 6000, rubricShare: 6000, rubricMode: 'percent', basisPoints: 5000 },
      { table: 2, rubricId: B, amountMinor: 1400, studentsCount: 1, rubricShare: 1400, tariffMinor: 12000, rubricMode: 'percent', basisPoints: 2000, socialVersionId: 'social_x' }] };
    const cleaned = withoutSocialForecast(forecast);
    expect(cleaned.rows[0]).toEqual(forecast.rows[0]);
    expect(cleaned.rows[1]).toEqual({ table: 2, rubricId: B, amountMinor: 1400, studentsCount: 1, tariffMinor: 12000 });
    expect(cleaned).not.toHaveProperty('socialStudentCount');
  });
});
