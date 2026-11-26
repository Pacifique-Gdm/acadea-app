import type { SchoolSection } from "../../types";
import { sectionManagerId } from "../../utils/sectionSettingsManagers";
import type { SectionSettingsManagers } from "../../utils/sectionSettingsManagers";
import { ModifiedBy } from "./ModifiedBy";

// Lot R6 : les responsables se lisent avec useSectionSettingsManagers (src/hooks/useSectionSettingsManagers.ts).

/** « Géré par [nom, fonction] » à la place des boutons de réglage d'une section confiée à un autre responsable. Rien sinon. */
export function SectionManagedBy({ schoolId, section, currentUserId, managers }: { schoolId: string; section: SchoolSection | null | undefined; currentUserId?: string; managers: SectionSettingsManagers }) {
  const managerId = sectionManagerId(managers, section);
  if (!managerId || managerId === currentUserId) return null;
  return <ModifiedBy verb="Géré" userId={managerId} schoolId={schoolId} />;
}
