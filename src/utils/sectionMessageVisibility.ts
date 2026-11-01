import type { AppUser, Message } from "../types";
import { sectionAdministratorQuerySections } from "./sectionAdministratorYearScope";

/** Last-mile cache guard, not a substitute for server/rules authorization. */
export function sectionMessageVisible(user: AppUser, message: Message, schoolId: string, schoolYearId?: string) {
  try {
    const sections = sectionAdministratorQuerySections(user, schoolId);
    return message.schoolId === schoolId && (!schoolYearId || message.schoolYearId === schoolYearId)
      && Boolean(message.section && sections.includes(message.section))
      && Boolean(message.participantIds?.includes(user.id));
  } catch { return false; }
}
