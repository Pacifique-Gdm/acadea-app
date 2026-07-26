const PRODUCTION_MARKER = /acadea[-_.]?production|acadea[-_.]?prod|\bproduction\b/i;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const STAGING_ORIGIN = "https://acadea-staging.vercel.app";

export type E2EEnvironment = { baseUrl: string; firebaseProjectId: string };

export function assertSafeE2EEnvironment(env: NodeJS.ProcessEnv): E2EEnvironment {
  const baseUrl = (env.ACADEA_E2E_BASE_URL || STAGING_ORIGIN).replace(/\/$/, "");
  const firebaseProjectId = env.VITE_FIREBASE_PROJECT_ID || "acadea-staging";
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(`E2E bloqué : URL invalide (${baseUrl}).`);
  }

  if (PRODUCTION_MARKER.test(baseUrl) || PRODUCTION_MARKER.test(firebaseProjectId) || firebaseProjectId === "acadea-production") {
    throw new Error("E2E bloqué : une URL ou un Firebase projectId Production a été détecté.");
  }

  const isStaging = parsedUrl.origin === STAGING_ORIGIN && firebaseProjectId === "acadea-staging";
  const isLocalStaging = LOCAL_HOSTS.has(parsedUrl.hostname) && firebaseProjectId === "acadea-staging";
  if (!isStaging && !isLocalStaging) {
    throw new Error(`E2E bloqué : cible non autorisée (${parsedUrl.origin} / ${firebaseProjectId}).`);
  }

  const appEnvironment = (env.VITE_APP_ENV || env.VERCEL_ENV || env.NODE_ENV || "test").toLowerCase();
  if (appEnvironment === "production" && env.ACADEA_E2E_CONFIRM_STAGING !== "YES") {
    throw new Error("E2E bloqué : environnement production sans ACADEA_E2E_CONFIRM_STAGING=YES.");
  }

  return { baseUrl, firebaseProjectId };
}
