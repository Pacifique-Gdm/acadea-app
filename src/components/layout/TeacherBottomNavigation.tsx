import { teacherTabs, type TeacherTab } from "./teacherNavigation";
import { MobileBottomNavigation } from "./MobileBottomNavigation";

export function TeacherBottomNavigation({ activeTab, onTab }: { activeTab: TeacherTab; onTab: (tab: TeacherTab) => void }) {
  return <MobileBottomNavigation ariaLabel="Navigation Enseignant" items={teacherTabs} activeId={activeTab} onSelect={onTab} maxWidthClass="max-w-2xl" />;
}
