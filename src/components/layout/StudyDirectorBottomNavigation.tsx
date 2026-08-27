import { studyDirectorTabs } from "./studyDirectorNavigation";
import type { StudyDirectorTab } from "./studyDirectorNavigation";
import { MobileBottomNavigation } from "./MobileBottomNavigation";

export function StudyDirectorBottomNavigation({ activeTab, onTab }: { activeTab: StudyDirectorTab; onTab: (tab: StudyDirectorTab) => void }) {
  return <MobileBottomNavigation ariaLabel="Navigation Direction des études" items={studyDirectorTabs} activeId={activeTab} onSelect={onTab} maxWidthClass="max-w-3xl" />;
}
