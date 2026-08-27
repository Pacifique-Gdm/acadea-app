import { BookOpen, CalendarDays, CheckCircle2, Menu as MenuIcon, MessageSquare } from "lucide-react";
import { InstallPwaNavButton } from "./InstallPwaNavButton";
import { MobileBottomNavigation } from "./MobileBottomNavigation";

type DisciplineTab = "status" | "attendance" | "messages" | "menu";

export function DisciplineBottomNavigation({
  activeTab,
  showInstallButton,
  onInstallPwa,
  onTab,
}: {
  activeTab: DisciplineTab;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onTab: (tab: DisciplineTab) => void;
}) {
  const tabs = [
    { id: "status", label: "Statut", icon: CheckCircle2 },
    { id: "attendance", label: "Présence", icon: CalendarDays },
    { id: "messages", label: "Messages", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ] satisfies { id: DisciplineTab; label: string; icon: typeof BookOpen }[];

  return <MobileBottomNavigation ariaLabel="Navigation Discipline" items={tabs} activeId={activeTab} onSelect={onTab} maxWidthClass="max-w-2xl" trailingItem={showInstallButton ? <InstallPwaNavButton onInstall={onInstallPwa} /> : undefined} />;
}
