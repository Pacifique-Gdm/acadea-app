// Lots 10 et 11 : onglets du bas des modules des conseillers.
import { BarChart3, BookOpen, CalendarDays, ClipboardList, GraduationCap, LayoutDashboard, Menu as MenuIcon, NotebookPen } from "lucide-react";

export type PedagogicalAdvisorTab = "dashboard" | "teachers" | "visits" | "schedules" | "menu";
export const pedagogicalAdvisorTabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "teachers", label: "Enseignants", icon: BookOpen },
  { id: "visits", label: "Visites", icon: ClipboardList },
  { id: "schedules", label: "Horaires", icon: CalendarDays },
  { id: "menu", label: "Menu", icon: MenuIcon },
] satisfies { id: PedagogicalAdvisorTab; label: string; icon: typeof BookOpen }[];

export type OrientationAdvisorTab = "dashboard" | "students" | "notes" | "results" | "menu";
export const orientationAdvisorTabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "students", label: "Élèves", icon: GraduationCap },
  { id: "notes", label: "Suivi", icon: NotebookPen },
  { id: "results", label: "Résultats", icon: BarChart3 },
  { id: "menu", label: "Menu", icon: MenuIcon },
] satisfies { id: OrientationAdvisorTab; label: string; icon: typeof BookOpen }[];
