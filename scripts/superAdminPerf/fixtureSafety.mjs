// Écoles fictives pour mesurer le Super administrateur. STAGING UNIQUEMENT.
// Chaque document créé porte la marque FIXTURE_TAG et un identifiant qui commence
// par FIXTURE_PREFIX : l'effacement n'accepte que les documents qui ont les deux.

export const STAGING_PROJECT = "acadea-staging";
export const FIXTURE_TAG = "perf-super-admin";
export const FIXTURE_PREFIX = "perf-sa-";
export const FIXTURE_NAME_PREFIX = "[FICTIVE]";
export const MAX_FIXTURE_SCHOOLS = 15_000;
// Collections que la commande peut créer puis effacer, et rien d'autre.
export const FIXTURE_COLLECTIONS = Object.freeze(["schools", "schoolYears", "users"]);

const LOCALITIES = ["Lumbula", "Pangu", "Kalamu", "Matete", "Lemba", "Ngaliema", "Kintambo", "Masina", "Ndjili", "Limete"];
const KINDS = ["Complexe scolaire", "Institut", "École", "Lycée", "Collège"];
const TYPES = ["Primaire", "Secondaire", "Mixte", "Maternelle", "CTEB"];

export function assertStagingProject(projectId) {
  if (projectId !== STAGING_PROJECT) {
    throw new Error(`Refusé : les écoles fictives ne sont permises que sur ${STAGING_PROJECT} (projet demandé : ${projectId || "aucun"}).`);
  }
}

export function parseSchoolTotal(value) {
  const total = Number(value);
  if (!Number.isInteger(total) || total < 1 || total > MAX_FIXTURE_SCHOOLS) {
    throw new Error(`Nombre d'écoles fictives invalide : donnez un nombre entier entre 1 et ${MAX_FIXTURE_SCHOOLS}.`);
  }
  return total;
}

export function fixtureNumber(index) {
  return String(index).padStart(5, "0");
}

/** Documents d'une école fictive n° index (1, 2, 3…). Toujours les mêmes pour un même numéro. */
export function buildFixtureSchool(index, createdAt) {
  const number = fixtureNumber(index);
  const schoolId = `${FIXTURE_PREFIX}school-${number}`;
  const yearId = `${FIXTURE_PREFIX}year-${number}`;
  const adminId = `${FIXTURE_PREFIX}admin-${number}`;
  const locality = LOCALITIES[index % LOCALITIES.length];
  const kind = KINDS[index % KINDS.length];
  const name = `${FIXTURE_NAME_PREFIX} ${kind} ${locality} ${number}`;
  const marker = { fixture: FIXTURE_TAG };
  return [
    {
      collection: "schools",
      id: schoolId,
      data: {
        ...marker,
        id: schoolId,
        schoolId,
        name,
        address: `${locality} (adresse fictive)`,
        phone: "",
        email: `${adminId}@example.invalid`,
        currency: index % 3 === 0 ? "CDF" : "USD",
        activeSchoolYearId: yearId,
        logoUrl: "",
        acronym: `F${number}`,
        educationLevels: ["Primaire"],
        schoolOptions: [],
        schoolType: TYPES[index % TYPES.length],
        createdAt,
        createdBy: "perf-fixture",
        mainAdminId: adminId,
        status: index % 10 === 0 ? "suspended" : "active",
        subscriptionPlan: "basic",
        subscriptionStatus: index % 10 === 0 ? "suspended" : "active",
        subscriptionAmount: 0,
      },
    },
    {
      collection: "schoolYears",
      id: yearId,
      data: { ...marker, id: yearId, schoolId, name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-15", status: "active", currency: index % 3 === 0 ? "CDF" : "USD" },
    },
    {
      // Profil seulement : aucun compte de connexion n'est créé.
      collection: "users",
      id: adminId,
      data: { ...marker, id: adminId, name: `Administrateur fictif ${number}`, email: `${adminId}@example.invalid`, role: "school_admin", schoolId, activeSchoolYearId: yearId, status: "active", createdAt },
    },
  ];
}

/** Un document peut être effacé seulement s'il porte la marque ET le préfixe, dans une collection prévue. */
export function isFixtureDocument(collectionName, id, data) {
  return FIXTURE_COLLECTIONS.includes(collectionName)
    && typeof id === "string"
    && id.startsWith(FIXTURE_PREFIX)
    && data?.fixture === FIXTURE_TAG
    && (data?.id === undefined || data.id === id);
}
