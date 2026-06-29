import { CLASSES } from "../src/types";

export const stagingTeachers = [
  {
    id: "teacher-1",
    schoolId: "school-1",
    schoolYearId: "year-2025",
    fullName: "Blaise Mukendi",
    phone: "+243 899 111 222",
    email: "blaise.mukendi@example.cd",
    classNames: ["4ème Primaire", "6ème Primaire"],
    status: "active",
  },
  {
    id: "teacher-2",
    schoolId: "school-1",
    schoolYearId: "year-2025",
    fullName: "Nadine Kayembe",
    phone: "+243 899 333 444",
    email: "nadine.kayembe@example.cd",
    classNames: ["2ème Primaire", "3ème Primaire"],
    status: "active",
  },
];

export const stagingClasses = CLASSES.map((className) => ({
  id: `class-${className.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
  schoolId: "school-1",
  schoolYearId: "year-2025",
  name: className,
  status: "active",
}));
