// Choix du projet visé par un outil de migration (lots 8 et 9).
// - Par défaut : staging, avec les mêmes conditions qu'avant (inchangées).
// - Production : seulement avec --project=acadea-production, la confirmation
//   --confirm-production=acadea-production, ACADEA_PRODUCTION_MIGRATION=YES et le
//   jeton ACADEA_PRODUCTION_ACCESS_TOKEN (jeton OAuth court, jamais affiché ni écrit).
// - Toujours refusé si un émulateur est configuré (risque de confusion).
export const MIGRATION_TARGETS = {
  "acadea-staging": { projectId: "acadea-staging", bucketName: "acadea-staging.firebasestorage.app", tokenVariable: "ACADEA_STAGING_ACCESS_TOKEN", label: "staging" },
  "acadea-production": { projectId: "acadea-production", bucketName: "acadea-production.firebasestorage.app", tokenVariable: "ACADEA_PRODUCTION_ACCESS_TOKEN", label: "production" },
};

export function parseMigrationArgs(argv) {
  return Object.fromEntries(argv.map((arg) => { const [key, ...rest] = arg.replace(/^--/, "").split("="); return [key, rest.length ? rest.join("=") : true]; }));
}

/** Retourne le projet visé et son jeton, ou lève une erreur sans rien écrire. */
export function resolveMigrationTarget({ args, env, stagingFlag }) {
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Émulateur configuré : migration refusée.");
  const requested = args.project === undefined ? "acadea-staging" : args.project;
  const target = typeof requested === "string" && Object.hasOwn(MIGRATION_TARGETS, requested) ? MIGRATION_TARGETS[requested] : undefined;
  if (!target) throw new Error("Projet inconnu : seuls acadea-staging et acadea-production sont acceptés.");
  if (target.label === "staging") {
    if (env.GOOGLE_CLOUD_PROJECT !== target.projectId || env[stagingFlag] !== "YES" || !env[target.tokenVariable]) throw new Error("Migration réservée au projet acadea-staging avec autorisation explicite.");
  } else if (env.GOOGLE_CLOUD_PROJECT !== target.projectId || env.ACADEA_PRODUCTION_MIGRATION !== "YES" || args["confirm-production"] !== target.projectId || !env[target.tokenVariable]) {
    throw new Error("Migration de production refusée : confirmation explicite manquante.");
  }
  if (typeof args.school !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(args.school)) throw new Error("Indiquez --school=<identifiant de l'école>.");
  return { ...target, token: env[target.tokenVariable] };
}
