import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import { apiErrorMessage } from "../utils/rateLimitErrors";
import type { AuditLog } from "../types";

/**
 * Lot SA-4 : drawer d'école léger. Le serveur envoie les nombres déjà calculés et l'historique page par page ;
 * le navigateur ne lit plus les élèves, parents, paiements, dépenses, messages, notifications, valves et frais.
 */
export type SchoolDrawerClassCount = { className: string; option: string; count: number };
export type SchoolDrawerSummary = { students: number; parents: number; admins: number; users: number; classes: SchoolDrawerClassCount[] };
export type SchoolHistoryLog = Pick<AuditLog, "id" | "action" | "actorName" | "createdAt"> & { schoolYearId?: string };
export type SchoolHistoryPage = { logs: SchoolHistoryLog[]; page: number; total: number; hasMore: boolean };
export type SchoolDrawerDetail = { summary: SchoolDrawerSummary; history: SchoolHistoryPage };

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isText = (value: unknown): value is string => typeof value === "string";

/** Refuse toute réponse incomplète : le drawer affiche alors un message d'erreur, jamais un chiffre faux. */
export function parseSchoolDrawerSummary(value: unknown): SchoolDrawerSummary {
  const summary = value as Partial<SchoolDrawerSummary> | null;
  if (!summary || ![summary.students, summary.parents, summary.admins, summary.users].every(isCount) || !Array.isArray(summary.classes)) {
    throw new Error("Données de l'école incomplètes.");
  }
  const classes = summary.classes.map((item) => {
    const row = item as Partial<SchoolDrawerClassCount> | null;
    if (!row || !isText(row.className) || !isText(row.option) || !isCount(row.count)) throw new Error("Données de l'école incomplètes.");
    return { className: row.className, option: row.option, count: row.count };
  });
  return { students: summary.students!, parents: summary.parents!, admins: summary.admins!, users: summary.users!, classes };
}

export function parseSchoolHistoryPage(value: unknown): SchoolHistoryPage {
  const history = value as Partial<SchoolHistoryPage> | null;
  if (!history || !Array.isArray(history.logs) || !isCount(history.page) || !isCount(history.total) || typeof history.hasMore !== "boolean") {
    throw new Error("Historique de l'école incomplet.");
  }
  const logs = history.logs.map((item) => {
    const row = item as Partial<SchoolHistoryLog> | null;
    if (!row || !isText(row.id) || !isText(row.action) || !isText(row.actorName) || !isText(row.createdAt)) throw new Error("Historique de l'école incomplet.");
    return { id: row.id, action: row.action, actorName: row.actorName, createdAt: row.createdAt, ...(isText(row.schoolYearId) ? { schoolYearId: row.schoolYearId } : {}) };
  });
  return { logs, page: history.page!, total: history.total!, hasMore: history.hasMore! };
}

async function postSchoolDrawer(body: Record<string, unknown>, fallback: string) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-school"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { summary?: unknown; history?: unknown; error?: string; code?: string };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, fallback));
  return payload;
}

/** Ouverture du drawer : une seule demande au serveur (nombres + première page d'historique). */
export async function loadSchoolDrawerDetail(schoolId: string, schoolYearId: string): Promise<SchoolDrawerDetail> {
  const payload = await postSchoolDrawer({ action: "school-drawer", schoolId, schoolYearId }, "Impossible de charger les données de cette école.");
  return { summary: parseSchoolDrawerSummary(payload.summary), history: parseSchoolHistoryPage(payload.history) };
}

/** « Voir plus » dans l'historique : page suivante seulement. */
export async function loadSchoolHistoryPage(schoolId: string, schoolYearId: string, page: number): Promise<SchoolHistoryPage> {
  const payload = await postSchoolDrawer({ action: "school-history", schoolId, schoolYearId, page }, "Historique de l'école indisponible.");
  return parseSchoolHistoryPage(payload.history);
}

/** Ajoute une page à l'historique déjà affiché, sans doublon. */
export function appendSchoolHistoryPage(current: SchoolHistoryPage, next: SchoolHistoryPage): SchoolHistoryPage {
  const known = new Set(current.logs.map((log) => log.id));
  return { logs: [...current.logs, ...next.logs.filter((log) => !known.has(log.id))], page: next.page, total: next.total, hasMore: next.hasMore };
}
