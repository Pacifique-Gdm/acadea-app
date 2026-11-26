import { useEffect, useMemo, useState } from "react";
import { subscribeToSectionSettingsManagers } from "../services/sectionSettingsManagers";
import { toAuthorityManagers } from "../utils/sectionSettingsManagers";
import type { SectionSettingsManagers } from "../utils/sectionSettingsManagers";

// Lot R6 : responsables des réglages de l'école, relus en direct.
// `authorityManagers` se passe tel quel à resolveSectionAuthority(…, { sectionSettingsManagers }).
export function useSectionSettingsManagers(schoolId: string | undefined) {
  const [managers, setManagers] = useState<SectionSettingsManagers>({});
  useEffect(() => {
    if (!schoolId) { setManagers({}); return undefined; }
    return subscribeToSectionSettingsManagers({ schoolId, onData: setManagers, onError: () => setManagers({}) });
  }, [schoolId]);
  const authorityManagers = useMemo(() => toAuthorityManagers(managers), [managers]);
  return { managers, authorityManagers };
}
