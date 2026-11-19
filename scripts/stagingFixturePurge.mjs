// Effacement COMPLET des écoles d'essai des recettes automatiques. STAGING UNIQUEMENT.
// Avant : les recettes « désactivaient » leurs écoles (status inactive) et les gardaient.
// Maintenant : l'école, tout ce qui lui appartient (mêmes collections que la suppression
// d'école du Super administrateur), ses comptes de connexion et les petits documents
// « signal » créés par les déclencheurs sont effacés.
//
// Un document n'est effacé que s'il porte la marque exacte de la recette (fixtureId = tag,
// identifiant commençant par le tag) ou s'il appartient (schoolId) à une école d'essai vérifiée.
import { deleteSchoolCompletely } from '../api/_lib/schoolDeletion.js';

export const STAGING_PROJECT = 'acadea-staging';
export const FIXTURE_TAG = /^e2e-[a-z]+-[a-f0-9]{32}$/;
/** Délai laissé aux déclencheurs (feeAllocationForecastSignals) avant le dernier passage. */
export const TRIGGER_SETTLE_MS = 60_000;
const ACTOR = Object.freeze({ uid: 'recette-staging-nettoyage', role: 'staging_fixture_cleanup' });

export function assertStagingFixtureTag(projectId, tag) {
  if (projectId !== STAGING_PROJECT) throw new Error(`Refusé : effacement réservé à ${STAGING_PROJECT}.`);
  if (!FIXTURE_TAG.test(tag ?? '')) throw new Error('Refusé : marque de recette invalide.');
}

/** Document créé par la recette `tag` : marque exacte et identifiant préfixé. */
export function isFixtureDocumentOf(tag, id, data) {
  return FIXTURE_TAG.test(tag ?? '')
    && typeof id === 'string' && id.startsWith(tag)
    && data?.fixtureId === tag
    && (data.id === undefined || data.id === id);
}

/** Écoles d'essai déjà « retirées » par l'ancienne clôture (désactivées et gardées). */
export function isRetiredFixtureSchool(id, data) {
  return typeof data?.fixtureId === 'string'
    && isFixtureDocumentOf(data.fixtureId, id, data)
    && data.status === 'inactive' && data.active === false && data.fixtureLifecycle === 'retired';
}

/**
 * Accès minimal au stockage des fichiers du staging (lister, effacer), par l'API officielle
 * avec le jeton OAuth de la recette. Même forme que le bucket attendu par la suppression d'école.
 */
export function stagingRestBucket(name, getToken, { fetchImpl = fetch } = {}) {
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(name)}/o`;
  const headers = async () => ({ Authorization: `Bearer ${(await getToken()).access_token}`, 'x-goog-user-project': STAGING_PROJECT });
  const file = (path) => ({
    name: path,
    async delete({ ignoreNotFound = false } = {}) {
      const response = await fetchImpl(`${base}/${encodeURIComponent(path)}`, { method: 'DELETE', headers: await headers() });
      if (response.ok || (ignoreNotFound && response.status === 404)) return;
      throw new Error(`Effacement du fichier refusé (${response.status}).`);
    },
  });
  return {
    file,
    async getFiles({ prefix }) {
      const files = [];
      let pageToken = '';
      do {
        const response = await fetchImpl(`${base}?prefix=${encodeURIComponent(prefix)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers: await headers() });
        if (!response.ok) throw new Error(`Liste des fichiers refusée (${response.status}).`);
        const body = await response.json();
        for (const item of body.items ?? []) files.push(file(item.name));
        pageToken = body.nextPageToken ?? '';
      } while (pageToken);
      return [files];
    },
  };
}

/** Sous-collections connues des documents d'essai (Firestore ne les efface pas avec leur parent). */
export const FIXTURE_SUBCOLLECTIONS = Object.freeze({ feeAllocationReconciliationRuns: ['pages', 'versions'], feeAllocationOpeningAudits: ['evidencePages'] });

/** Sous-documents laissés sans parent (recherche sur tout le groupe, sans filtre), appartenant aux écoles données. */
export async function deleteOrphanSubdocuments(db, schoolIds) {
  const owned = new Set(schoolIds);
  let deleted = 0;
  for (const names of Object.values(FIXTURE_SUBCOLLECTIONS)) for (const name of names) {
    const rows = (await db.collectionGroup(name).get()).docs.filter((doc) => owned.has(doc.data()?.schoolId));
    deleted += await deleteRefs(db, rows.map((doc) => doc.ref));
  }
  return deleted;
}

async function deleteRefs(db, refs) {
  for (const ref of refs) {
    const children = FIXTURE_SUBCOLLECTIONS[ref.parent?.id] ?? [];
    for (const child of children) {
      const rows = await ref.collection(child).select().get();
      for (let start = 0; start < rows.docs.length; start += 400) {
        const batch = db.batch();
        for (const row of rows.docs.slice(start, start + 400)) batch.delete(row.ref);
        await batch.commit();
      }
    }
  }
  for (let start = 0; start < refs.length; start += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(start, start + 400)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}

/** Passe sur toutes les collections : documents marqués `tag` ou appartenant aux écoles d'essai. */
async function sweep(db, tag, schoolIds) {
  let deleted = 0;
  for (const collection of await db.listCollections()) {
    const refs = new Map();
    const marked = await collection.where('fixtureId', '==', tag).get().catch(() => ({ docs: [] }));
    for (const doc of marked.docs) if (isFixtureDocumentOf(tag, doc.id, doc.data())) refs.set(doc.ref.path, doc.ref);
    for (const schoolId of schoolIds) {
      const owned = await collection.where('schoolId', '==', schoolId).select().get().catch(() => ({ docs: [] }));
      for (const doc of owned.docs) refs.set(doc.ref.path, doc.ref);
    }
    deleted += await deleteRefs(db, [...refs.values()]);
  }
  return deleted;
}

/** Comptes de connexion de la recette : identifiant préfixé par le tag et adresse fictive. */
async function deleteFixtureAccounts(auth, tag, uids) {
  let deleted = 0;
  for (const uid of new Set(uids)) {
    if (!uid.startsWith(tag)) continue;
    try {
      const account = await auth.getUser(uid);
      if (!String(account.email ?? '').endsWith('@example.invalid')) throw new Error('Compte étranger : effacement refusé.');
      await auth.deleteUser(uid);
      deleted += 1;
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
  }
  return deleted;
}

/**
 * Efface tout ce qu'a créé la recette `tag` sur le staging.
 * `extraUids` : comptes connus par le manifeste (coordinateurs sans école, etc.).
 */
export async function purgeStagingFixture({ db, auth, bucket, projectId, tag, extraUids = [], settleMs = TRIGGER_SETTLE_MS, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  assertStagingFixtureTag(projectId, tag);
  const schools = (await db.collection('schools').where('fixtureId', '==', tag).get()).docs;
  for (const school of schools) if (!isFixtureDocumentOf(tag, school.id, school.data())) throw new Error(`École étrangère ${school.id} : effacement refusé.`);
  const schoolIds = schools.map((school) => school.id);
  const users = (await db.collection('users').where('fixtureId', '==', tag).get()).docs.filter((doc) => isFixtureDocumentOf(tag, doc.id, doc.data()));
  const report = { tag, schools: schoolIds.length, accounts: 0, documents: 0 };
  report.accounts += await deleteFixtureAccounts(auth, tag, [...users.map((doc) => doc.id), ...extraUids]);
  for (const school of schools) {
    const result = await deleteSchoolCompletely({ db, auth, bucket, schoolId: school.id, schoolData: school.data(), actor: ACTOR });
    report.documents += result.firestore.deleted + 1;
    report.accounts += result.auth.deleted;
  }
  report.documents += await sweep(db, tag, schoolIds);
  // Les déclencheurs écrivent après coup des « signaux » portant l'école : dernier passage.
  if (schoolIds.length && settleMs > 0) { await wait(settleMs); report.documents += await sweep(db, tag, schoolIds); }
  return report;
}

/** Restes éventuels de la recette `tag` (lecture seule). */
export async function fixtureLeftovers(db, tag, schoolIds = []) {
  const leftovers = [];
  for (const collection of await db.listCollections()) {
    const marked = await collection.where('fixtureId', '==', tag).limit(5).select().get().catch(() => ({ size: 0 }));
    let owned = 0;
    for (const schoolId of schoolIds) owned += (await collection.where('schoolId', '==', schoolId).limit(5).select().get().catch(() => ({ size: 0 }))).size;
    if (marked.size || owned) leftovers.push(`${collection.id} : ${marked.size + owned}`);
  }
  return leftovers;
}
