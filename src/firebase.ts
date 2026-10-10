import { initializeApp } from "firebase/app";
import { connectAuthEmulator, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { getValidatedFirebaseConfig } from "./config/environment";

const configuredFirebase = getValidatedFirebaseConfig({
  appEnv: import.meta.env.VITE_APP_ENV,
  localEmulator: import.meta.env.DEV && import.meta.env.VITE_LOCAL_EMULATORS === "true",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const firebaseConfig = configuredFirebase.config;
export const firebaseEnvironment = configuredFirebase.validation;

export const firebaseReady = true;

if (firebaseEnvironment.environment === "staging" && import.meta.env.DEV) {
  console.info([
    "====================================",
    "ENVIRONMENT : STAGING",
    `Firebase : ${firebaseConfig.projectId}`,
    "Vercel : staging",
    "====================================",
  ].join("\n"));
}

export const app = firebaseReady ? initializeApp(firebaseConfig) : undefined;
export const auth = app ? initializeAuth(app, { persistence: indexedDBLocalPersistence }) : undefined;
export const db = app ? getFirestore(app) : undefined;
export const storage = app ? getStorage(app) : undefined;

// Opt-in explicite pour les E2E locaux : aucune connexion aux services distants.
if (import.meta.env.DEV && import.meta.env.VITE_LOCAL_EMULATORS === "true" && typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
  if (auth) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  if (db) connectFirestoreEmulator(db, "127.0.0.1", 8080);
  if (storage) connectStorageEmulator(storage, "127.0.0.1", 9199);
}
