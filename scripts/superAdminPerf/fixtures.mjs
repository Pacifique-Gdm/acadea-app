// Écoles fictives sur le STAGING pour mesurer le Super administrateur.
//   TOKEN=$(gcloud auth print-access-token) node scripts/superAdminPerf/fixtures.mjs compter
//   TOKEN=$(gcloud auth print-access-token) node scripts/superAdminPerf/fixtures.mjs creer 500
//   TOKEN=$(gcloud auth print-access-token) node scripts/superAdminPerf/fixtures.mjs effacer            (essai à blanc)
//   TOKEN=$(gcloud auth print-access-token) node scripts/superAdminPerf/fixtures.mjs effacer --confirmer
// « creer N » complète jusqu'à N écoles fictives au total (les numéros déjà présents sont gardés).
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { assertStagingProject, buildFixtureSchool, FIXTURE_COLLECTIONS, FIXTURE_TAG, isFixtureDocument, parseSchoolTotal, STAGING_PROJECT } from "./fixtureSafety.mjs";

const [command, argument] = process.argv.slice(2);
const projectId = process.env.ACADEA_FIXTURE_PROJECT ?? STAGING_PROJECT;
assertStagingProject(projectId);
if (!process.env.TOKEN) throw new Error("Lancez d'abord : TOKEN=$(gcloud auth print-access-token)");

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: process.env.TOKEN });
const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });

async function fixtureRefs(collectionName) {
  const snapshot = await db.collection(collectionName).where("fixture", "==", FIXTURE_TAG).select("fixture", "id").get();
  return snapshot.docs.filter((item) => isFixtureDocument(collectionName, item.id, item.data()));
}

async function count() {
  const result = {};
  for (const name of FIXTURE_COLLECTIONS) result[name] = (await db.collection(name).where("fixture", "==", FIXTURE_TAG).count().get()).data().count;
  return result;
}

async function create(total) {
  const existing = new Set((await fixtureRefs("schools")).map((item) => item.id));
  const createdAt = new Date().toISOString();
  let writer = db.batch(), pending = 0, created = 0;
  for (let index = 1; index <= total; index += 1) {
    const documents = buildFixtureSchool(index, createdAt);
    if (existing.has(documents[0].id)) continue;
    for (const item of documents) { writer.create(db.collection(item.collection).doc(item.id), item.data); pending += 1; }
    created += 1;
    if (pending >= 450) { await writer.commit(); writer = db.batch(); pending = 0; process.stdout.write(`\r${created} école(s) créée(s)…`); }
  }
  if (pending) await writer.commit();
  console.log(`\n${created} école(s) fictive(s) ajoutée(s) ; ${existing.size} existaient déjà.`);
}

async function retire(confirmed) {
  let total = 0;
  for (const name of FIXTURE_COLLECTIONS) {
    const refs = await fixtureRefs(name);
    total += refs.length;
    console.log(`${name} : ${refs.length} document(s) fictif(s)${confirmed ? " à effacer" : ""}.`);
    if (!confirmed) continue;
    for (let start = 0; start < refs.length; start += 450) {
      const writer = db.batch();
      for (const item of refs.slice(start, start + 450)) writer.delete(item.ref);
      await writer.commit();
    }
  }
  if (!confirmed) console.log(`Essai à blanc : ${total} document(s) seraient effacés. Rien n'a été effacé. Ajoutez --confirmer pour effacer.`);
  else console.log(`${total} document(s) fictif(s) effacé(s). Reste : ${JSON.stringify(await count())}`);
}

try {
  if (command === "compter") console.log(JSON.stringify(await count()));
  else if (command === "creer") { await create(parseSchoolTotal(argument)); console.log(JSON.stringify(await count())); }
  else if (command === "effacer") await retire(argument === "--confirmer");
  else console.log("Commandes : compter | creer <nombre> | effacer [--confirmer]");
} finally {
  await db.terminate();
}
