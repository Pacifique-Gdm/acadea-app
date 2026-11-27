// Lots 10 et 11 : onglets du bas des modules des conseillers.
import { BookOpen, CalendarDays, ClipboardList, LayoutDashboard, Menu as MenuIcon } from "lucide-react";

export type PedagogicalAdvisorTab = "dashboard" | "teachers" | "visits" | "schedules" | "menu";
export const pedagogicalAdvisorTabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "teachers", label: "Enseignants", icon: BookOpen },
  { id: "visits", label: "Visites", icon: ClipboardList },
  { id: "schedules", label: "Horaires", icon: CalendarDays },
  { id: "menu", label: "Menu", icon: MenuIcon },
] satisfies { id: PedagogicalAdvisorTab; label: string; icon: typeof BookOpen }[];

