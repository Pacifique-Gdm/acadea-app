import { BookOpen, CalendarDays, LayoutDashboard, Menu } from "lucide-react";

export type TeacherTab = "dashboard" | "courses" | "schedule" | "menu";

export const teacherTabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "courses", label: "Mes cours", icon: BookOpen },
  { id: "schedule", label: "Mon horaire", icon: CalendarDays },
  { id: "menu", label: "Menu", icon: Menu },
] as const satisfies ReadonlyArray<{ id: TeacherTab; label: string; icon: typeof LayoutDashboard }>;
