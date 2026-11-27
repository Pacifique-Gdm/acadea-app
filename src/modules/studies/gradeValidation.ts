// Lot P6 (Préfet d'études) : validation des bulletins avant publication, par le serveur.
// Exigée seulement si un Préfet d'études existe pour la section de la classe ; sinon rien ne change.
import { resolveApiUrl } from "../../config/apiUrl";
import { getCurrentFirebaseIdToken } from "../../services/auth";

export type GradeValidationState = {
  validated: boolean;
  /** Validée, mais des cotes ont changé depuis : nouvelle validation nécessaire. */
  stale: boolean;
  fingerprint: string;
  validatedAt?: string;
  validatedByName?: string;
  validatedByFunction?: string;
};
export type GradeValidationStatus = { required: boolean; validations?: Partial<Record<string, GradeValidationState>> };

async function request<T>(body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<T> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetcher(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? "Validation des bulletins indisponible.");
  return payload;
}

export const loadGradeValidationStatus = (schoolId: string, schoolYearId: string, classId: string, fetcher?: typeof fetch) =>
  request<GradeValidationStatus>({ action: "grades-validation-status", schoolId, schoolYearId, classId }, fetcher);
export const validateGrades = (input: { schoolId: string; schoolYearId: string; classId: string; slot: string; expectedFingerprint: string }, fetcher?: typeof fetch) =>
  request<{ ok: true; validated: true; validatedAt: string }>({ action: "grades-validation-validate", ...input }, fetcher);
export const cancelGradeValidation = (input: { schoolId: string; schoolYearId: string; classId: string; slot: string }, fetcher?: typeof fetch) =>
  request<{ ok: true; validated: false }>({ action: "grades-validation-cancel", ...input }, fetcher);

/** Texte de l'état pour une période (affiché au Préfet et à la Direction des études). */
export function validationLabel(state: GradeValidationState | undefined) {
  if (state?.validated) return "Validé";
  if (state?.stale) return "Cotes modifiées depuis la validation : à valider de nouveau";
  return "À valider";
}
