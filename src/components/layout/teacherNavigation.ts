import { Baby, BookOpen, CalendarDays, LayoutDashboard, Menu } from "lucide-react";

export type TeacherTab = "dashboard" | "courses" | "schedule" | "children" | "menu";

export const teacherTabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "courses", label: "Mes cours", icon: BookOpen },
  { id: "schedule", label: "Mon horaire", icon: CalendarDays },
  // Lot 3 : enfants à la charge de l'enseignant (décision de prise en charge « Personnel de l'école »).
  { id: "children", label: "Enfants", icon: Baby },
  { id: "menu", label: "Menu", icon: Menu },
] as const satisfies ReadonlyArray<{ id: TeacherTab; label: string; icon: typeof LayoutDashboard }>;
