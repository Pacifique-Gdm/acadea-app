import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import { apiErrorMessage } from "../utils/rateLimitErrors";

/** Lot SA-3 : chiffres du Dashboard Super administrateur, calculés par le serveur. */
export type PlatformSchoolCounts = { total: number; active: number; suspended: number; pending: number; inactive: number };
export type PlatformStats = {
  schools: PlatformSchoolCounts;
  students: number;
  parents: number;
  admins: number;
  /** Heure du dernier calcul des élèves, parents et administrateurs. */
  computedAt: string;
  /** Heure du dernier recomptage des écoles (plus récent après une action sur une école). */
  schoolsComputedAt: string;
};

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Refuse toute réponse incomplète : le Dashboard affiche alors « — », jamais un chiffre faux. */
export function parsePlatformStats(value: unknown): PlatformStats {
  const stats = value as Partial<PlatformStats> | null;
  const schools = stats?.schools as Partial<PlatformSchoolCounts> | undefined;
  if (!stats || !schools
    || ![schools.total, schools.active, schools.suspended, schools.pending, schools.inactive, stats.students, stats.parents, stats.admins].every(isCount)
    || !isTime(stats.computedAt)) {
    throw new Error("Statistiques globales incomplètes.");
  }
  return {
    schools: { total: schools.total!, active: schools.active!, suspended: schools.suspended!, pending: schools.pending!, inactive: schools.inactive! },
    students: stats.students!,
    parents: stats.parents!,
    admins: stats.admins!,
    computedAt: stats.computedAt!,
    schoolsComputedAt: isTime(stats.schoolsComputedAt) ? stats.schoolsComputedAt : stats.computedAt!,
  };
}

export async function loadPlatformStats({ force = false }: { force?: boolean } = {}): Promise<PlatformStats> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-school"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "platform-stats", force }),
  });
  const payload = (await response.json().catch(() => ({}))) as { stats?: unknown; error?: string; code?: string };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Statistiques globales indisponibles."));
  return parsePlatformStats(payload.stats);
}

/** « 14:05 » : heure locale du calcul, affichée sous les chiffres. */
export function platformStatsTimeLabel(stats: PlatformStats) {
  return new Date(stats.computedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
