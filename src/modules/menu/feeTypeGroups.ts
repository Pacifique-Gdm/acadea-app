import type { FeeType, School } from "../../types";
import { CLASSES } from "../../types";
import { getSchoolSections } from "../../utils/schoolConfig";
import { getClassSection } from "../../utils/studentClasses";
import { canonicalAnnualClassName } from "../../utils/studentYearTransition.js";
import { feeTargetClassName } from "../../utils/feeTargets";

/** Presentation only: retain each persisted fee identity and its annual scope. */
export function groupFeeTypes(fees: FeeType[], school: School, schoolYearId: string) {
  const scoped = fees.filter((fee) => fee.schoolId === school.id && fee.schoolYearId === schoolYearId);
  const parentOf = (fee: FeeType) => canonicalAnnualClassName(fee.className || feeTargetClassName(fee.classOptionKey || ""));
  const sections = getSchoolSections(school);
  const sortFees = (items: FeeType[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, "fr") || (a.classOptionKey || "").localeCompare(b.classOptionKey || "", "fr") || a.id.localeCompare(b.id));
  const groups = sections.map((section) => ({
    section,
    classes: CLASSES.filter((name) => getClassSection(name) === section).map((name) => ({ name, fees: sortFees(scoped.filter((fee) => parentOf(fee) === name)) })).filter((group) => group.fees.length > 0),
  })).filter((group) => group.classes.length > 0);
  const legacy = sortFees(scoped.filter((fee) => { const parent = parentOf(fee); return !parent || !sections.includes(getClassSection(parent)); }));
  return { groups, legacy };
}
