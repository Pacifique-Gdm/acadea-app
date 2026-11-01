import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import { sectionAdministratorQuerySections } from "../utils/sectionAdministratorYearScope";
import type { AppUser, SchoolClassRecord, Student } from "../types";

type Records = { classes: SchoolClassRecord; students: Student };
export async function loadSectionSchoolRecords<K extends keyof Records>(
  kind: K, user: AppUser, schoolId: string, schoolYearId: string, signal?: AbortSignal,
): Promise<Records[K][]> {
  const sections = sectionAdministratorQuerySections(user, schoolId);
  if (!schoolYearId) throw new Error("Année scolaire requise.");
  const token = await getCurrentFirebaseIdToken();
  if (!token) throw new Error("Authentification requise.");
  const records = new Map<string, Records[K]>();
  const cursors = new Set<string>();
  let cursorId: string | undefined;
  do {
    const response = await fetch(resolveApiUrl("/api/provision-school-account"), {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list-section-school-records", kind, schoolYearId, ...(cursorId ? { cursorId } : {}) }),
    });
    if (!response.ok) throw new Error("Chargement scolaire refusé ou indisponible. Veuillez réessayer.");
    const page = await response.json() as { schoolId: string; schoolYearId: string; items: Records[K][]; nextCursorId: unknown };
    if (page.schoolId !== schoolId || page.schoolYearId !== schoolYearId || !Array.isArray(page.items)
      || page.items.some((item) => !item || typeof item.id !== "string" || item.schoolId !== schoolId
        || item.schoolYearId !== schoolYearId || !item.section || !sections.includes(item.section))) {
      throw new Error("Réponse scolaire hors périmètre.");
    }
    for (const item of page.items) records.set(item.id, item);
    if (page.nextCursorId !== null && (typeof page.nextCursorId !== "string" || !page.nextCursorId || cursors.has(page.nextCursorId))) {
      throw new Error("Pagination scolaire invalide.");
    }
    cursorId = page.nextCursorId === null ? undefined : page.nextCursorId as string;
    if (cursorId) cursors.add(cursorId);
  } while (cursorId);
  return [...records.values()];
}
