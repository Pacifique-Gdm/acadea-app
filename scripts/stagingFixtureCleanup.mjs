// Nettoyage des écoles d'essai déjà « retirées » (désactivées et gardées) du STAGING.
//   ACADEA_SOCIAL_STAGING=YES GOOGLE_CLOUD_PROJECT=acadea-staging GOOGLE_CLOUD_QUOTA_PROJECT=acadea-staging \
//   ACADEA_STAGING_ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/stagingFixtureCleanup.mjs [--confirmer | verifier]
// Sans option : essai à blanc (liste, rien n'est effacé ; la liste est gardée dans diagnostics/).
// --confirmer : efface, recette par recette. verifier : cherche les restes des recettes listées.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { services } from './socialFinanceStagingFixture.mjs';
import { fixtureLeftovers, isRetiredFixtureSchool, purgeStagingFixture, STAGING_PROJECT } from './stagingFixturePurge.mjs';

const mode = process.argv[2] ?? 'essai';
const listPath = 'diagnostics/staging-fixture-cleanup/liste.json';
const s = services();
try {
  if (mode === 'verifier') {
    if (!existsSync(listPath)) throw new Error('Liste absente : lancez d\'abord l\'essai à blanc.');
    const list = JSON.parse(readFileSync(listPath, 'utf8'));
    let problems = 0;
    for (const group of list.groups) {
      const leftovers = await fixtureLeftovers(s.db, group.tag, group.schools);
      if (leftovers.length) { problems += 1; console.log(`${group.tag} : restes → ${leftovers.join(', ')}`); }
    }
    const retired = (await s.db.collection('schools').where('fixtureLifecycle', '==', 'retired').get()).docs.filter((doc) => isRetiredFixtureSchool(doc.id, doc.data()));
    console.log(problems || retired.length ? `Restes : ${problems} recette(s), ${retired.length} école(s) retirée(s).` : `Aucun reste pour les ${list.groups.length} recettes, aucune école d'essai retirée.`);
  } else {
    const schools = (await s.db.collection('schools').where('fixtureLifecycle', '==', 'retired').get()).docs.filter((doc) => isRetiredFixtureSchool(doc.id, doc.data()));
    const groups = new Map();
    for (const doc of schools) { const tag = doc.data().fixtureId; groups.set(tag, [...(groups.get(tag) ?? []), doc.id]); }
    const list = { projectId: STAGING_PROJECT, at: new Date().toISOString(), schools: schools.length, groups: [...groups].map(([tag, ids]) => ({ tag, schools: ids })) };
    mkdirSync('diagnostics/staging-fixture-cleanup', { recursive: true });
    if (mode !== '--confirmer') {
      writeFileSync(listPath, JSON.stringify(list, null, 2));
      console.log(`Essai à blanc : ${schools.length} école(s) d'essai retirée(s), ${groups.size} recette(s). Rien n'a été effacé. Liste : ${listPath}`);
    } else {
      if (!existsSync(listPath)) throw new Error('Lancez d\'abord l\'essai à blanc.');
      let done = 0;
      for (const [tag] of groups) {
        const report = await purgeStagingFixture({ db: s.db, auth: s.auth, bucket: s.bucket, projectId: process.env.GOOGLE_CLOUD_PROJECT, tag, settleMs: 0 });
        done += 1; console.log(`${done}/${groups.size} ${tag} : ${report.schools} école(s), ${report.documents} document(s), ${report.accounts} compte(s)`);
      }
      // Un seul délai pour tous les déclencheurs, puis dernier passage sur chaque recette.
      console.log('Attente des déclencheurs (60 s)…');
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      const previous = JSON.parse(readFileSync(listPath, 'utf8'));
      for (const group of previous.groups) await purgeStagingFixture({ db: s.db, auth: s.auth, bucket: s.bucket, projectId: process.env.GOOGLE_CLOUD_PROJECT, tag: group.tag, settleMs: 0 }).catch(() => undefined);
      for (const group of previous.groups) {
        const signals = [];
        for (const schoolId of group.schools) signals.push(...(await s.db.collection('feeAllocationForecastSignals').where('schoolId', '==', schoolId).get()).docs);
        for (const doc of signals) await doc.ref.delete();
      }
      console.log(`Effacement terminé : ${groups.size} recette(s). Lancez « verifier ».`);
    }
  }
} finally {
  await s.close();
}
