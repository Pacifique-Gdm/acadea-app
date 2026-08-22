import type { Student } from "../types";
import { CLASSES } from "../types";
import { formatStudentClassName } from "./studentClasses";

export type DashboardClassDisplayRow = {
  schoolId?: string;
  schoolName?: string;
  className: string;
  girls: number;
  boys: number;
  total: number;
};

export function buildDashboardClassRows(students: Student[], schoolName?: (schoolId: string) => string): DashboardClassDisplayRow[] {
  return [...students.reduce<Map<string, DashboardClassDisplayRow & { classOrder: number; optionLabel: string }>>((rows, student) => {
    const className = formatStudentClassName(student);
    const key = schoolName ? `${student.schoolId}:${className}` : className;
    const current = rows.get(key) ?? {
      schoolId: schoolName ? student.schoolId : undefined,
      schoolName: schoolName?.(student.schoolId),
      className,
      girls: 0,
      boys: 0,
      total: 0,
      classOrder: CLASSES.indexOf(student.className),
      optionLabel: student.option?.trim() ?? "",
    };
    current.girls += student.sexe === "F" ? 1 : 0;
    current.boys += student.sexe === "M" ? 1 : 0;
    current.total += 1;
    rows.set(key, current);
    return rows;
  }, new Map()).values()]
    .sort((first, second) => (first.schoolName ?? "").localeCompare(second.schoolName ?? "", "fr") || first.classOrder - second.classOrder || first.optionLabel.localeCompare(second.optionLabel, "fr"))
    .map((row) => ({ schoolId: row.schoolId, schoolName: row.schoolName, className: row.className, girls: row.girls, boys: row.boys, total: row.total }));
}
