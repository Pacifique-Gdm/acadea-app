import { BookOpen, CalendarDays, CheckCircle2, Menu as MenuIcon, MessageSquare } from "lucide-react";
import { InstallPwaNavButton } from "./InstallPwaNavButton";

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

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:px-2">
      <div className={`mx-auto grid w-full max-w-2xl ${showInstallButton ? "grid-cols-5" : "grid-cols-4"} gap-1`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTab(tab.id)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-2 text-[10px] font-semibold transition min-[360px]:text-[11px] sm:px-1 sm:text-xs ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
              aria-current={active ? "page" : undefined}
              type="button"
            >
              <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-700" : "text-slate-400"}`} />
              <span className="max-w-full truncate">{tab.label}</span>
            </button>
          );
        })}
        {showInstallButton && <InstallPwaNavButton onInstall={onInstallPwa} />}
      </div>
    </nav>
  );
}
