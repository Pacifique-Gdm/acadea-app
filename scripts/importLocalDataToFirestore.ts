import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { doc, getFirestore, setDoc } from "firebase/firestore";
import { demoData } from "../src/data/demoData";
import type { AppData } from "../src/types";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const appEnv = process.env.VITE_APP_ENV ?? process.env.VERCEL_ENV ?? "development";
const projectId = firebaseConfig.projectId ?? "";
const importAllowed = process.env.ACADEA_ALLOW_FIRESTORE_IMPORT === "true";
const safeProject = /staging|preview|test|demo|dev/i.test(projectId);

if (!firebaseConfig.apiKey || !projectId) {
  throw new Error("Renseignez les variables VITE_FIREBASE_* avant l'import Firestore.");
}

if (appEnv === "production" || !safeProject || !importAllowed) {
  throw new Error(
    "Import Firestore refusé. Utilisez un projet staging/preview/test/demo et ACADEA_ALLOW_FIRESTORE_IMPORT=true.",
  );
}

const sourceFile = process.env.ACADEA_LOCAL_DATA_FILE;
const sourceData = sourceFile
  ? ({ ...demoData, ...JSON.parse(readFileSync(sourceFile, "utf8")) } as AppData)
  : demoData;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const collections: { [K in keyof AppData]: string } = {
  users: "users",
  schools: "schools",
  schoolYears: "schoolYears",
  students: "students",
  parents: "parents",
  feeTypes: "feeTypes",
  payments: "payments",
  expenses: "expenses",
  messages: "messages",
  notifications: "notifications",
  auditLogs: "auditLogs",
};

async function importCollection<T extends { id: string }>(collectionName: string, items: T[]) {
  await Promise.all(items.map((item) => setDoc(doc(db, collectionName, item.id), item)));
}

for (const [key, collectionName] of Object.entries(collections) as [keyof AppData, string][]) {
  await importCollection(collectionName, sourceData[key] as { id: string }[]);
}

console.log(`Données importées dans Firestore pour le projet "${projectId}".`);
