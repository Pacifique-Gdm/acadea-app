export type SchoolSectionAction = "check" | "uncheck";

export const SCHOOL_SECTION_CONFIRMATIONS: Record<SchoolSectionAction, string> = {
  check: "COCHER CETTE SECTION",
  uncheck: "DÉCOCHER CETTE SECTION",
};

export function isSchoolSectionConfirmation(action: SchoolSectionAction, value: string): boolean {
  return value === SCHOOL_SECTION_CONFIRMATIONS[action];
}
