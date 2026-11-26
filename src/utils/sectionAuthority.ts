import type { AppUser, School, SchoolSection } from "../types";
import { getSchoolSections } from "./schoolConfig";
import { userSectionIds } from "./userSections";

/**
 * Périmètre de réglage par section (règle unique des sections).
 *
 * - Un compte SANS section agit pour toute l'école (fonctionnement d'avant).
 * - Un compte dont les sections couvrent TOUTES les sections de l'école
 *   (calcul `getSchoolSections`) agit aussi pour toute l'école.
 * - Sinon, il agit seulement sur SES sections (celles qui existent dans l'école).
 *
 * On ne compte jamais « le seul » responsable d'une section.
 * Même logique côté serveur : `api/_lib/sectionAuthority.js`.
 */
export interface SectionAuthority {
  /** Vrai si le compte agit pour toute l'école. */
  wholeSchool: boolean;
  /** Sections que le compte peut régler (toutes celles de l'école s'il agit pour toute l'école). */
  sections: SchoolSection[];
  /** Sections de l'école. */
  schoolSections: SchoolSection[];
}

export interface SectionAuthorityOptions {
  /**
   * Point d'extension pour le lot R6 (« responsable des réglages de la section ») :
   * section → identifiant du compte désigné. Quand il sera branché, seul le compte
   * désigné pourra régler une telle section. NON UTILISÉ pour l'instant : le
   * résultat est identique avec ou sans ce paramètre.
   */
  sectionSettingsManagers?: Partial<Record<SchoolSection, string>>;
}

export function resolveSectionAuthority(
  user: Pick<AppUser, "section" | "sectionIds">,
  school: Pick<School, "educationLevels" | "schoolType">,
  // R6 : options.sectionSettingsManagers sera lu ici.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: SectionAuthorityOptions = {},
): SectionAuthority {
  const schoolSections = getSchoolSections(school);
  const assigned = userSectionIds(user);
  const wholeSchool = assigned.length === 0
    || (schoolSections.length > 0 && schoolSections.every((section) => assigned.includes(section)));
  return {
    wholeSchool,
    sections: wholeSchool ? [...schoolSections] : schoolSections.filter((section) => assigned.includes(section)),
    schoolSections,
  };
}

/**
 * Le compte peut-il régler cet élément ?
 * `sections` vide ou absent = élément « toute l'école » : réservé à un compte qui agit pour toute l'école.
 * Sinon, toutes les sections de l'élément doivent faire partie de son périmètre.
 */
export function canManageSections(authority: SectionAuthority, sections?: readonly SchoolSection[] | null): boolean {
  if (authority.wholeSchool) return true;
  if (!sections || sections.length === 0) return false;
  return sections.every((section) => authority.sections.includes(section));
}
