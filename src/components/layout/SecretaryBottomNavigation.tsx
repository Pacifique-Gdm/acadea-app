import { FileText, GraduationCap, Mail, Menu as MenuIcon, MessageSquare } from "lucide-react";
import { InstallPwaNavButton } from "./InstallPwaNavButton";
import { MobileBottomNavigation } from "./MobileBottomNavigation";

export type SecretaryTab = "students" | "correspondence" | "reports" | "messages" | "menu";

export function SecretaryBottomNavigation({
  activeTab,
  showInstallButton,
  onInstallPwa,
  onTab,
}: {
  activeTab: SecretaryTab;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onTab: (tab: SecretaryTab) => void;
}) {
  const tabs = [
    { id: "students" as const, label: "Élèves", icon: GraduationCap },
    { id: "correspondence" as const, label: "Courriers", icon: Mail },
    { id: "reports" as const, label: "Rapports", icon: FileText },
    { id: "messages" as const, label: "Message", icon: MessageSquare },
    { id: "menu" as const, label: "Menu", icon: MenuIcon },
  ];

  return <MobileBottomNavigation ariaLabel="Navigation Secrétaire" items={tabs} activeId={activeTab} onSelect={onTab} maxWidthClass="max-w-2xl" trailingItem={showInstallButton ? <InstallPwaNavButton onInstall={onInstallPwa} /> : undefined} />;
}
