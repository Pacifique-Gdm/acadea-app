import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function currentEnvironment() {
  return process.env.VITE_APP_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

function isProtectedEnvironment(environment) {
  return environment === "production" || environment === "staging" || environment === "preview";
}

function expectedProjectId(environment) {
  if (environment === "production") {
    return process.env.ACADEA_EXPECTED_PRODUCTION_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "";
  }
  if (environment === "staging" || environment === "preview") {
    return process.env.ACADEA_EXPECTED_PREVIEW_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "";
  }
  return process.env.VITE_FIREBASE_PROJECT_ID || "";
}

function assertProjectConsistency({ environment, credentialProjectId }) {
  const expected = expectedProjectId(environment);
  const frontendProjectId = process.env.VITE_FIREBASE_PROJECT_ID || "";

  if (!credentialProjectId) {
    throw new Error("Configuration Firebase Admin invalide: project_id absent du compte de service.");
  }
  if (expected && credentialProjectId !== expected) {
    throw new Error(`Configuration Firebase Admin incoherente: projet serveur "${credentialProjectId}" au lieu de "${expected}".`);
  }
  if (frontendProjectId && credentialProjectId !== frontendProjectId) {
    throw new Error(`Configuration Firebase incoherente: projet serveur "${credentialProjectId}" different du projet frontend "${frontendProjectId}".`);
  }
}

function parseServiceAccount(rawValue, source) {
  try {
    const serviceAccount = JSON.parse(rawValue);
    if (!serviceAccount || typeof serviceAccount !== "object") {
      throw new Error("JSON invalide.");
    }
    return serviceAccount;
  } catch {
    throw new Error(`Configuration Firebase Admin invalide: ${source} ne contient pas un JSON valide.`);
  }
}

function serviceAccountFromEnvironment(environment) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, "FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  if (process.env.VERCEL || isProtectedEnvironment(environment)) {
    throw new Error("Configuration Firebase Admin manquante: FIREBASE_SERVICE_ACCOUNT_JSON est obligatoire pour cet environnement.");
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return parseServiceAccount(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"), "GOOGLE_APPLICATION_CREDENTIALS");
  }

  if (process.env.NODE_ENV !== "production" && existsSync("service-account.json")) {
    return parseServiceAccount(readFileSync("service-account.json", "utf8"), "service-account.json");
  }

  throw new Error("Configuration Firebase Admin manquante: aucun compte de service explicite disponible.");
}

export function getVerifiedServiceAccount() {
  const environment = currentEnvironment();
  const serviceAccount = serviceAccountFromEnvironment(environment);
  assertProjectConsistency({
    environment,
    credentialProjectId: typeof serviceAccount.project_id === "string" ? serviceAccount.project_id : "",
  });
  return serviceAccount;
}

export function initAdmin() {
  if (getApps().length === 0) {
    initializeApp({ credential: cert(getVerifiedServiceAccount()) });
  }

  return {
    auth: getAuth(),
    db: getFirestore(),
    get bucket() {
      return getStorage().bucket();
    },
  };
}

const PUBLIC_FIREBASE_ERRORS = new Map([
  ["auth/email-already-exists", "Un compte utilise déjà cette adresse e-mail."],
  ["auth/invalid-email", "L’adresse e-mail fournie est invalide."],
  ["auth/invalid-password", "Le mot de passe fourni est invalide."],
  ["auth/user-not-found", "Le compte demandé est introuvable."],
  ["auth/id-token-expired", "La session a expiré. Veuillez vous reconnecter."],
  ["auth/argument-error", "Les informations transmises sont invalides."],
]);

function correlationId() {
  return `acadea-${randomUUID()}`;
}

export function firebaseAdminPublicError(error, context = "firebase-admin") {
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.startsWith("Configuration Firebase Admin") || message.startsWith("Configuration Firebase incoherente")) {
    const id = correlationId();
    console.error("[Acadéa API] Erreur Firebase Admin interne.", {
      correlationId: id,
      context,
      code: "firebase-admin/configuration-error",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      code: "firebase-admin/configuration-error",
      message: "Le service est temporairement indisponible.",
      correlationId: id,
    };
  }
  if (PUBLIC_FIREBASE_ERRORS.has(rawCode)) {
    return {
      code: rawCode,
      message: PUBLIC_FIREBASE_ERRORS.get(rawCode),
    };
  }
  const id = correlationId();
  console.error("[Acadéa API] Erreur Firebase Admin interne.", {
    correlationId: id,
    context,
    code: rawCode || "internal",
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return {
    code: "internal",
    message: "Le service est temporairement indisponible.",
    correlationId: id,
  };
}
