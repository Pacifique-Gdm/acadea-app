import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { handleSecretaryCorrespondenceFile } from "../functions/lib/audit/secretaryCorrespondenceFile.js";

const requireFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp: initializeAdminApp, getApps: getAdminApps } = requireFunctions("firebase-admin/app");
const { getAuth: getAdminAuth } = requireFunctions("firebase-admin/auth");
const { getFirestore: getAdminFirestore } = requireFunctions("firebase-admin/firestore");
const { getStorage: getAdminStorage } = requireFunctions("firebase-admin/storage");

const projectId = "demo-acadea-security-s1-s4";
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error("Ce test exige exclusivement les trois émulateurs Firebase du projet demo.");
}
const bucketName = `${projectId}.appspot.com`;
if (!getAdminApps().length) initializeAdminApp({ projectId, storageBucket: bucketName });
const adminAuth = getAdminAuth();
const db = getAdminFirestore();
const bucket = getAdminStorage().bucket();
const app = initializeApp({ apiKey: "demo-key", authDomain: "localhost", projectId, storageBucket: bucketName, appId: "demo-app" });
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
const storage = getStorage(app);
const [storageHost, storagePort] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(":");
connectStorageEmulator(storage, storageHost, Number(storagePort));
async function invoke(data) {
  if (!auth.currentUser) throw new Error("Local test user not authenticated");
  const idToken = await auth.currentUser.getIdToken();
  const decoded = await adminAuth.verifyIdToken(idToken);
  return { data: await handleSecretaryCorrespondenceFile({ auth: { uid: decoded.uid, token: decoded }, data }) };
}
const fixture = `e2e-pr29-${Date.now()}`;
const schoolA = `${fixture}-school-a`;
const schoolB = `${fixture}-school-b`;
const secretary = `${fixture}-secretary`;
const parent = `${fixture}-parent`;
const corrA = `${fixture}-corr-a`;
const corrB = `${fixture}-corr-b`;
const password = randomBytes(24).toString("base64url");
const created = [];
let checks = 0;

async function put(collection, id, data) {
  const reference = db.collection(collection).doc(id);
  await reference.create({ fixtureId: fixture, ...data });
  created.push(reference);
}
async function rejects(call) {
  await assert.rejects(call, (error) => {
    assert.match(String(error?.code ?? error?.message), /permission-denied|failed-precondition|not-found|unauthorized/);
    return true;
  });
  checks++;
}
try {
  await put("schools", schoolA, { status: "active" });
  await put("schools", schoolB, { status: "active" });
  await put("correspondences", corrA, { schoolId: schoolA, status: "received", schoolYearId: `${fixture}-year` });
  await put("correspondences", corrB, { schoolId: schoolB, status: "received", schoolYearId: `${fixture}-year` });
  await put("users", secretary, { role: "secretary", schoolId: schoolA, status: "active", active: true });
  await put("users", parent, { role: "parent", schoolId: schoolA, status: "active", active: true, parentId: parent });
  await adminAuth.createUser({ uid: secretary, email: `${secretary}@example.test`, password });
  await adminAuth.setCustomUserClaims(secretary, { role: "secretary", schoolId: schoolA });
  await adminAuth.createUser({ uid: parent, email: `${parent}@example.test`, password });
  await adminAuth.setCustomUserClaims(parent, { role: "parent", schoolId: schoolA, parentId: parent });

  await signInWithEmailAndPassword(auth, `${secretary}@example.test`, password);
  const first = await invoke({ action: "upload", correspondenceId: corrA, name: "preuve.pdf", contentType: "application/pdf", dataBase64: Buffer.from("fixture-pr29").toString("base64") });
  const firstPath = first.data.attachment.path;
  assert.match(firstPath, new RegExp(`^schools/${schoolA}/correspondences/${corrA}/`));
  assert.equal((await db.doc(`correspondences/${corrA}`).get()).data().attachment.path, firstPath);
  checks += 2;
  const read = await invoke({ action: "download", correspondenceId: corrA });
  assert.equal(Buffer.from(read.data.dataBase64, "base64").toString(), "fixture-pr29");
  checks++;
  await rejects(() => getDownloadURL(ref(storage, firstPath)));
  await rejects(() => uploadBytes(ref(storage, firstPath), new Uint8Array([1]), { contentType: "application/pdf" }));

  const second = await invoke({ action: "upload", correspondenceId: corrA, name: "preuve.pdf", contentType: "application/pdf", dataBase64: Buffer.from("replacement").toString("base64") });
  assert.notEqual(second.data.attachment.path, firstPath);
  checks++;
  await put("notifications", `${fixture}-notif`, { schoolId: schoolA, recipientUserId: parent, parentId: parent, type: "message", read: false });

  await signOut(auth);
  await signInWithEmailAndPassword(auth, `${parent}@example.test`, password);
  await rejects(() => invoke({ action: "download", correspondenceId: corrA }));
  await signOut(auth);
  await signInWithEmailAndPassword(auth, `${secretary}@example.test`, password);
  await db.doc(`users/${secretary}`).update({ schoolId: schoolB });
  await rejects(() => invoke({ action: "download", correspondenceId: corrA }));
  await adminAuth.setCustomUserClaims(secretary, { role: "secretary", schoolId: schoolB });
  await signOut(auth);
  await signInWithEmailAndPassword(auth, `${secretary}@example.test`, password);
  await rejects(() => invoke({ action: "download", correspondenceId: corrA }));
  const bPath = `schools/${schoolB}/correspondences/${corrB}/document.pdf`;
  await bucket.file(bPath).save(Buffer.from("school-b"), { contentType: "application/pdf", preconditionOpts: { ifGenerationMatch: 0 } });
  await db.doc(`correspondences/${corrB}`).update({ attachment: { path: bPath, name: "document.pdf", type: "application/pdf" } });
  const bRead = await invoke({ action: "download", correspondenceId: corrB });
  assert.equal(Buffer.from(bRead.data.dataBase64, "base64").toString(), "school-b");
  checks++;
  await db.doc(`users/${secretary}`).update({ schoolId: schoolA });
  await adminAuth.setCustomUserClaims(secretary, { role: "secretary", schoolId: schoolA });
  await signOut(auth);
  await signInWithEmailAndPassword(auth, `${secretary}@example.test`, password);
  await db.doc(`correspondences/${corrA}`).update({ status: "archived" });
  await rejects(() => invoke({ action: "upload", correspondenceId: corrA, name: "preuve.pdf", contentType: "application/pdf", dataBase64: "AQ==" }));
  await rejects(() => invoke({ action: "purge", correspondenceId: corrA, path: firstPath }));
  await invoke({ action: "download", correspondenceId: corrA });
  checks++;
  await db.doc(`schools/${schoolA}`).update({ status: "suspended" });
  await rejects(() => invoke({ action: "download", correspondenceId: corrA }));
  process.stdout.write(JSON.stringify({ status: "PASS", checks, fixture: "local-emulator-only" }) + "\n");
} finally {
  await signOut(auth).catch(() => undefined);
  for (const reference of created.reverse()) await reference.delete().catch(() => undefined);
  for (const uid of [secretary, parent]) await adminAuth.deleteUser(uid).catch(() => undefined);
  await bucket.deleteFiles({ prefix: `schools/${schoolA}/correspondences/` }).catch(() => undefined);
  await bucket.deleteFiles({ prefix: `schools/${schoolB}/correspondences/` }).catch(() => undefined);
}
