import { Banknote, BookOpen, GraduationCap, LayoutDashboard, Menu as MenuIcon, MessageSquare } from "lucide-react";
import { InstallPwaNavButton } from "./InstallPwaNavButton";
import { MobileBottomNavigation } from "./MobileBottomNavigation";
import type { AppUser } from "../../types";

type Tab = "dashboard" | "students" | "parents" | "control" | "reports" | "messages" | "menu";

export function BottomNavigation({
  user,
  activeTab,
  showInstallButton,
  onInstallPwa,
  onTab,
}: {
  user: AppUser;
  activeTab: Tab;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onTab: (tab: Tab) => void;
}) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "students", label: "Élèves", icon: GraduationCap },
    { id: "control", label: "Contrôle", icon: Banknote },
    { id: "messages", label: "Message", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ].filter((tab) => (user.role === "cashier" ? ["dashboard", "control", "messages", "menu"].includes(tab.id) : true)) as { id: Tab; label: string; icon: typeof BookOpen }[];

  return <MobileBottomNavigation ariaLabel="Navigation principale" items={tabs} activeId={activeTab} onSelect={onTab} maxWidthClass={user.role === "cashier" ? "max-w-lg" : "max-w-4xl"} trailingItem={showInstallButton ? <InstallPwaNavButton onInstall={onInstallPwa} /> : undefined} />;
}
