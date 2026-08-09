import { BookOpen, CalendarDays, LayoutDashboard, Menu as MenuIcon } from "lucide-react";

export type StudyDirectorTab = "dashboard" | "teachers" | "schedules" | "menu";

export const studyDirectorTabs = [
  { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { id: "teachers", label: "Enseignants", icon: BookOpen },
  { id: "schedules", label: "Horaires", icon: CalendarDays },
  { id: "menu", label: "Menu", icon: MenuIcon },
] satisfies { id: StudyDirectorTab; label: string; icon: typeof BookOpen }[];
