// Lot 15 — ouverture d'une année scolaire : seulement le NOM (« 2026-2027 ») ; les dates en sont calculées.
// Règle (heure de Kinshasa) : l'année en cours bascule le 1er août ; l'année suivante peut être ouverte
// à partir du 1er juillet. Une année en avance, déjà passée ou déjà existante est refusée.
const KINSHASA_OFFSET_MS = 60 * 60 * 1000;
const label = (start) => `${start}-${start + 1}`;

export function normalizeSchoolYearName(name) {
  return String(name ?? "").trim().replace(/\s*[-–]\s*/, "-");
}
export function schoolYearStartOf(name) {
  const match = /^(\d{4})-(\d{4})$/.exec(normalizeSchoolYearName(name));
  return match && Number(match[2]) === Number(match[1]) + 1 ? Number(match[1]) : null;
}
/** Dates calculées depuis le nom : du 1er septembre au 31 juillet. */
export function schoolYearDatesFromName(name) {
  const start = schoolYearStartOf(name);
  return start === null ? null : { startsAt: `${start}-09-01`, endsAt: `${start + 1}-07-31` };
}
/** Année en cours selon la date (heure de Kinshasa) : à partir du 1er août, AAAA-(AAAA+1). */
export function currentSchoolYearStart(now = new Date()) {
  const local = new Date(now.getTime() + KINSHASA_OFFSET_MS);
  return local.getUTCMonth() + 1 >= 8 ? local.getUTCFullYear() : local.getUTCFullYear() - 1;
}

/** Décision commune (Coordinateur et Administrateur d'une école libre), avec un message clair. */
export function schoolYearOpeningDecision(name, { now = new Date(), existingNames = [] } = {}) {
  const clean = normalizeSchoolYearName(name);
  const start = schoolYearStartOf(clean);
  if (start === null) return { ok: false, code: "invalid-name", message: "Le nom de l'année doit être de la forme 2026-2027 : deux années qui se suivent." };
  const local = new Date(now.getTime() + KINSHASA_OFFSET_MS);
  const month = local.getUTCMonth() + 1, current = currentSchoolYearStart(now);
  const nextAllowed = month === 7 && start === local.getUTCFullYear();
  if (start > current && !nextAllowed) {
    return { ok: false, code: "year-too-early", message: `Impossible d'ouvrir l'année ${clean} maintenant : l'année en cours est ${label(current)}. L'année ${clean} pourra être ouverte à partir du 1er juillet ${start}.` };
  }
  if (start < current) return { ok: false, code: "year-in-past", message: `L'année ${clean} est déjà passée : l'année en cours est ${label(current)}.` };
  if (existingNames.some((existing) => normalizeSchoolYearName(existing) === clean)) {
    return { ok: false, code: "year-already-exists", message: `Une année « ${clean} » existe déjà dans cette école.` };
  }
  return { ok: true, name: clean, ...schoolYearDatesFromName(clean) };
}
