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
  /** R6 : sections confiées à un autre responsable désigné (présent seulement s'il y en a). */
  managedByOthers?: SchoolSection[];
}

export interface SectionAuthorityOptions {
  /**
   * Lot R6 (« responsable des réglages de la section ») : section → identifiant du compte désigné.
   * Dans une section qui a un responsable désigné, seul lui la règle ; les autres sections
   * suivent la règle unique des sections. Sans désignation : résultat inchangé.
   */
  sectionSettingsManagers?: Partial<Record<SchoolSection, string>>;
}

export function resolveSectionAuthority(
  user: Pick<AppUser, "section" | "sectionIds"> & { id?: string },
  school: Pick<School, "educationLevels" | "schoolType">,
  options: SectionAuthorityOptions = {},
): SectionAuthority {
  const schoolSections = getSchoolSections(school);
  const assigned = userSectionIds(user);
  const wholeSchool = assigned.length === 0
    || (schoolSections.length > 0 && schoolSections.every((section) => assigned.includes(section)));
  const sections = wholeSchool ? [...schoolSections] : schoolSections.filter((section) => assigned.includes(section));
  // R6 : une section confiée à un autre compte désigné n'est plus réglable par celui-ci.
  const managers = options.sectionSettingsManagers ?? {};
  const managedByOthers = schoolSections.filter((section) => Boolean(managers[section]) && managers[section] !== user.id);
  if (!managedByOthers.length) return { wholeSchool, sections, schoolSections };
  return { wholeSchool, sections: sections.filter((section) => !managedByOthers.includes(section)), schoolSections, managedByOthers };
}

/**
 * Le compte peut-il régler cet élément ?
 * `sections` vide ou absent = élément « toute l'école » : réservé à un compte qui agit pour toute l'école.
 * Sinon, toutes les sections de l'élément doivent faire partie de son périmètre.
 */
export function canManageSections(authority: SectionAuthority, sections?: readonly SchoolSection[] | null): boolean {
  if (sections?.some((section) => authority.managedByOthers?.includes(section))) return false;
  if (authority.wholeSchool) return true;
  if (!sections || sections.length === 0) return false;
  return sections.every((section) => authority.sections.includes(section));
}
