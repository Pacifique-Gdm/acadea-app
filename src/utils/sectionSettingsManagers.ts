// Lot R6 (réglages par section) : « Responsable des réglages de la section ».
// Même règle que le serveur (api/_lib/sectionSettingsManagers.js) : la case n'existe que pour une section
// secondaire (CTEB ou Secondaire) qui a à la fois un Préfet d'études ET un Directeur des études.
import type { AppUser, SchoolSection } from "../types";
import { userSectionIds } from "./userSections";

export const MANAGED_SECTIONS = ["CTEB", "Secondaire"] as const satisfies readonly SchoolSection[];
export type ManagedSection = typeof MANAGED_SECTIONS[number];
export type SectionManagerEntry = { userId: string; updatedAt?: string; updatedBy?: string };
export type SectionSettingsManagers = Partial<Record<ManagedSection, SectionManagerEntry>>;

type StudyAccount = Pick<AppUser, "id" | "role" | "schoolId" | "section" | "sectionIds"> & { status?: string; active?: boolean; studyFunction?: string };

const STUDY_FUNCTIONS = new Set(["director_of_studies", "prefect_of_studies", "primary_director", "nursery_director"]);
export const isManagedSection = (section: unknown): section is ManagedSection => MANAGED_SECTIONS.includes(section as ManagedSection);
const studyFunctionOf = (user: StudyAccount) => user.studyFunction && STUDY_FUNCTIONS.has(user.studyFunction) ? user.studyFunction : "director_of_studies";
const activeStudyAccount = (user: StudyAccount | undefined, schoolId: string): user is StudyAccount =>
  Boolean(user) && user!.role === "study_director" && user!.schoolId === schoolId && user!.status !== "inactive" && user!.active !== false;

/** Vrai si la section a à la fois un Préfet d'études et un Directeur des études (comptes actifs rattachés à la section). */
export function sectionNeedsManager(users: readonly StudyAccount[], schoolId: string, section: SchoolSection): boolean {
  if (!isManagedSection(section)) return false;
  const members = users.filter((user) => activeStudyAccount(user, schoolId) && userSectionIds(user).includes(section));
  return members.some((user) => studyFunctionOf(user) === "prefect_of_studies") && members.some((user) => studyFunctionOf(user) === "director_of_studies");
}

/** Sections pour lesquelles la case « Responsable des réglages » est proposée à ce compte. */
export function eligibleManagerSections(users: readonly StudyAccount[], schoolId: string, target: StudyAccount | undefined): ManagedSection[] {
  if (!activeStudyAccount(target, schoolId)) return [];
  return userSectionIds(target).filter((section): section is ManagedSection => sectionNeedsManager(users, schoolId, section));
}

/** Compte responsable désigné pour une section, s'il y en a un. */
export function sectionManagerId(managers: SectionSettingsManagers | undefined, section: SchoolSection | null | undefined): string | undefined {
  return section && isManagedSection(section) ? managers?.[section]?.userId || undefined : undefined;
}

/** Format attendu par resolveSectionAuthority(…, { sectionSettingsManagers }) : section → identifiant du compte désigné. */
export function toAuthorityManagers(managers: SectionSettingsManagers | undefined): Partial<Record<SchoolSection, string>> {
  const result: Partial<Record<SchoolSection, string>> = {};
  for (const section of MANAGED_SECTIONS) {
    const userId = managers?.[section]?.userId;
    if (userId) result[section] = userId;
  }
  return result;
}
