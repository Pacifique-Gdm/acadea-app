import { initializeApp } from "firebase/app";
import { collection, deleteDoc, doc, getDocs, getFirestore, setDoc } from "firebase/firestore";
import { demoData } from "../src/data/demoData";
import { stagingClasses, stagingTeachers } from "./stagingSeedData";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const projectId = firebaseConfig.projectId ?? "";
const allowedProjectName = /staging|preview|test|demo/i.test(projectId);
const resetAllowed = process.env.ACADEA_ALLOW_STAGING_RESET === "true";

if (!firebaseConfig.apiKey || !projectId) {
  throw new Error("Renseignez les variables VITE_FIREBASE_* du projet staging avant le reset.");
}

if (!allowedProjectName || !resetAllowed) {
  throw new Error(
    "Reset refusé. Utilisez un projectId staging/preview/test/demo et définissez ACADEA_ALLOW_STAGING_RESET=true.",
  );
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const collections = [
  "users",
  "schools",
  "schoolYears",
  "students",
  "classes",
  "teachers",
  "parents",
  "feeTypes",
  "payments",
  "expenses",
  "messages",
  "notifications",
  "auditLogs",
] as const;

async function clearCollection(collectionName: string) {
  const snapshot = await getDocs(collection(db, collectionName));
  await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
}

async function seedCollection<T extends { id: string }>(collectionName: string, items: T[]) {
  await Promise.all(items.map((item) => setDoc(doc(db, collectionName, item.id), item)));
}

for (const collectionName of collections) {
  await clearCollection(collectionName);
}

await seedCollection("users", demoData.users);
await seedCollection("schools", demoData.schools);
await seedCollection("schoolYears", demoData.schoolYears);
await seedCollection("students", demoData.students);
await seedCollection("classes", stagingClasses);
await seedCollection("teachers", stagingTeachers);
await seedCollection("parents", demoData.parents);
await seedCollection("feeTypes", demoData.feeTypes);
await seedCollection("payments", demoData.payments);
await seedCollection("expenses", demoData.expenses);
await seedCollection("messages", demoData.messages);
await seedCollection("notifications", demoData.notifications);
await seedCollection("auditLogs", demoData.auditLogs);

console.log(`Base de test réinitialisée et reseedée pour le projet Firebase "${projectId}".`);
