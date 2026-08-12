import { BookOpen, CalendarDays, GraduationCap, LayoutDashboard, Menu as MenuIcon } from "lucide-react";

export type StudyDirectorTab = "dashboard" | "teachers" | "students" | "schedules" | "menu";

export const studyDirectorTabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "teachers", label: "Enseignants", icon: BookOpen },
  { id: "students", label: "Élèves", icon: GraduationCap },
  { id: "schedules", label: "Horaires", icon: CalendarDays },
  { id: "menu", label: "Menu", icon: MenuIcon },
] satisfies { id: StudyDirectorTab; label: string; icon: typeof BookOpen }[];
