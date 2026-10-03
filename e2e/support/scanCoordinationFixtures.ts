import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

// Independent read-only scan: does not reuse the fixture's ownedRefs/cleanup code.
const prefixes = process.argv.slice(2);
if (!prefixes.length || prefixes.some((prefix) => !/^e2e-coord-finance-\d{13}-[a-f0-9]{6}$/.test(prefix))) throw new Error("Préfixes E2E requis.");
const environment = parse(readFileSync(".env.staging.local"));
const credential = JSON.parse(environment.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
if (credential.project_id !== "acadea-staging") throw new Error("Scan interdit hors Staging.");
const app = initializeApp({ credential: cert(credential), projectId: "acadea-staging", storageBucket: "acadea-staging.firebasestorage.app" }, "independent-fixture-scan");
try {
  const db = getFirestore(app); db.settings({ preferRest: true });
  let firestore = 0, auth = 0, storage = 0, collections = 0;
  for (const root of await db.listCollections()) {
    collections++;
    let cursor: string | undefined;
    while (true) {
      const base = root.orderBy(FieldPath.documentId()).limit(500);
      const snapshot = await (cursor ? base.startAfter(cursor) : base).get();
      for (const document of snapshot.docs) {
        const data = document.data();
        const rateLimitOwned = root.id === "_rateLimits" && prefixes.some((prefix) => ["super_admin", "school_admin", "cashier", "coordination_admin", "sub_coordination_admin"].some((role) => createHash("sha256").update(`${prefix}-${role}\u001factor\u001f${data.action}`).digest("hex") === data.actorIdHash));
        if (rateLimitOwned || prefixes.some((prefix) => document.id.includes(prefix) || JSON.stringify(data).includes(prefix))) firestore++;
      }
      if (snapshot.size < 500) break;
      cursor = snapshot.docs.at(-1)!.id;
    }
  }
  let pageToken: string | undefined;
  do {
    const page = await getAuth(app).listUsers(1000, pageToken);
    auth += page.users.filter((user) => prefixes.some((prefix) => user.uid.includes(prefix) || user.email?.includes(prefix))).length;
    pageToken = page.pageToken;
  } while (pageToken);
  const [files] = await getStorage(app).bucket().getFiles();
  storage = files.filter((file) => prefixes.some((prefix) => file.name.includes(prefix))).length;
  console.log(JSON.stringify({ independentScan: true, project: "acadea-staging", collections, firestoreResidues: firestore, authResidues: auth, storageResidues: storage }));
  if (firestore || auth || storage) process.exitCode = 1;
} finally { await deleteApp(app); }
