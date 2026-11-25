// Lot 2 (Direction des études) : fonction affichée d'un compte study_director.
// Le rôle technique reste study_director ; un compte sans fonction est un « Directeur des études ».
import type { AppUser } from "../types";

export const STUDY_FUNCTION_LABELS = {
  director_of_studies: "Directeur des études",
  prefect_of_studies: "Préfet d'études",
  primary_director: "Directeur primaire",
  nursery_director: "Directrice maternelle",
} as const;

export type StudyFunction = keyof typeof STUDY_FUNCTION_LABELS;

/** Libellé de la fonction pour un compte de la direction des études ; undefined pour tout autre rôle. */
export function studyFunctionLabel(user: Pick<AppUser, "role"> & { studyFunction?: string }): string | undefined {
  if (user.role !== "study_director") return undefined;
  return STUDY_FUNCTION_LABELS[user.studyFunction as StudyFunction] ?? STUDY_FUNCTION_LABELS.director_of_studies;
}
