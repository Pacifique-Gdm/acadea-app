import { BookOpen, GraduationCap, Menu as MenuIcon, MessageSquare } from "lucide-react";
import { InstallPwaNavButton } from "./InstallPwaNavButton";
import { MobileBottomNavigation } from "./MobileBottomNavigation";

type ParentTab = "children" | "messages" | "menu";

export function ParentBottomNavigation({
  activeTab,
  showInstallButton,
  onInstallPwa,
  onTab,
}: {
  activeTab: ParentTab;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onTab: (tab: ParentTab) => void;
}) {
  const tabs = [
    { id: "children", label: "Enfants", icon: GraduationCap },
    { id: "messages", label: "Message", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ] satisfies { id: ParentTab; label: string; icon: typeof BookOpen }[];

  return <MobileBottomNavigation ariaLabel="Navigation Parent" items={tabs} activeId={activeTab} onSelect={onTab} maxWidthClass="max-w-md" trailingItem={showInstallButton ? <InstallPwaNavButton onInstall={onInstallPwa} /> : undefined} />;
}
