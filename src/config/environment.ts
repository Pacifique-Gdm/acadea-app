export type AcadeaEnvironment = "staging" | "production";

export const FIREBASE_PROJECTS: Record<AcadeaEnvironment, string> = {
  staging: "acadea-staging",
  production: "acadea-production",
};

export type FirebaseEnvironmentInput = {
  appEnv?: string;
  projectId?: string;
  apiKey?: string;
  authDomain?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

export function getValidatedFirebaseConfig(input: FirebaseEnvironmentInput) {
  const validation = validateFirebaseEnvironment(input);
  return {
    validation,
    config: {
      apiKey: input.apiKey!,
      authDomain: input.authDomain!,
      projectId: input.projectId!,
      storageBucket: input.storageBucket!,
      messagingSenderId: input.messagingSenderId!,
      appId: input.appId!,
    },
  };
}

export function normalizeEnvironment(value?: string): AcadeaEnvironment {
  if (value === "production") return "production";
  if (["development", "preview", "staging"].includes(value ?? "")) return "staging";
  throw new Error(`Environnement Acadéa non reconnu : "${value || "absent"}".`);
}

export function validateFirebaseEnvironment(input: FirebaseEnvironmentInput) {
  const environment = normalizeEnvironment(input.appEnv);
  const expectedProjectId = FIREBASE_PROJECTS[environment];
  const missing = [
    ["VITE_FIREBASE_API_KEY", input.apiKey],
    ["VITE_FIREBASE_AUTH_DOMAIN", input.authDomain],
    ["VITE_FIREBASE_PROJECT_ID", input.projectId],
    ["VITE_FIREBASE_STORAGE_BUCKET", input.storageBucket],
    ["VITE_FIREBASE_MESSAGING_SENDER_ID", input.messagingSenderId],
    ["VITE_FIREBASE_APP_ID", input.appId],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([name]) => name);

  if (missing.length) {
    throw new Error(`Configuration Firebase ${environment} incomplète : ${missing.join(", ")}.`);
  }
  if (input.projectId !== expectedProjectId) {
    throw new Error(`Configuration Firebase refusée : ${environment} exige le projet "${expectedProjectId}", reçu "${input.projectId}".`);
  }
  if (!input.authDomain?.includes(expectedProjectId)) {
    throw new Error(`Configuration Firebase refusée : VITE_FIREBASE_AUTH_DOMAIN ne correspond pas à "${expectedProjectId}".`);
  }
  if (!input.storageBucket?.startsWith(expectedProjectId)) {
    throw new Error(`Configuration Firebase refusée : VITE_FIREBASE_STORAGE_BUCKET ne correspond pas à "${expectedProjectId}".`);
  }
  return { environment, expectedProjectId };
}
