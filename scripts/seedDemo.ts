import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { demoData } from "../src/data/demoData";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error("Renseignez les variables VITE_FIREBASE_* avant d'exécuter npm run seed.");
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function seedCollection<T extends { id: string }>(collectionName: string, items: T[]) {
  await Promise.all(items.map((item) => setDoc(doc(db, collectionName, item.id), item)));
}

await seedCollection("users", demoData.users);
await seedCollection("schools", demoData.schools);
await seedCollection("schoolYears", demoData.schoolYears);
await seedCollection("students", demoData.students);
await seedCollection("parents", demoData.parents);
await seedCollection("feeTypes", demoData.feeTypes);
await seedCollection("payments", demoData.payments);
await seedCollection("messages", demoData.messages);

console.log("Données de démonstration Acadéa importées dans Firestore.");
