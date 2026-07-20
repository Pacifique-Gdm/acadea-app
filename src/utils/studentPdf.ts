import type { School, SchoolClass, SchoolYear, Student } from "../types";
import { CLASSES } from "../types";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "./pdf";
import type { PdfTableColumn } from "./pdf";
import { formatStudentClassName } from "./studentClasses";

export function formatStudentPdfClassName(student: Pick<Student, "className" | "option">) {
  return student.className;
}

const studentPdfClassOrder: SchoolClass[] = [
  "Maternelle 1",
  "Maternelle 2",
  "Maternelle 3",
  "1ère Primaire",
  "2ème Primaire",
  "3ème Primaire",
  "4ème Primaire",
  "5ème Primaire",
  "6ème Primaire",
  "7ème CTEB",
  "8ème CTEB",
  "1ère Humanité",
  "2ème Humanité",
  "3ème Humanité",
  "4ème Humanité",
];

export function compareStudentsForPdfByClass(first: Pick<Student, "className">, second: Pick<Student, "className">) {
  const firstIndex = studentPdfClassOrder.indexOf(first.className);
  const secondIndex = studentPdfClassOrder.indexOf(second.className);
  const firstOrder = firstIndex === -1 ? Number.MAX_SAFE_INTEGER : firstIndex;
  const secondOrder = secondIndex === -1 ? Number.MAX_SAFE_INTEGER : secondIndex;
  return firstOrder - secondOrder;
}

export function sortStudentsForPdfByClass<T extends Pick<Student, "className">>(students: T[]) {
  return [...students].sort(compareStudentsForPdfByClass);
}

export async function exportStudentsPdf(school: School, year: SchoolYear, students: Student[], filters: string[]) {
  const showOptionColumn = students.some((student) => Boolean(student.option));
  const totalLabelColspan = showOptionColumn ? 5 : 4;
  const studentColumns: PdfTableColumn<Student>[] = [
    { header: "Matricule", render: (student) => student.matricule || "-" },
    { header: "Nom complet", render: (student) => `${student.nom} ${student.postnom} ${student.prenom}`.trim() || "-" },
    { header: "Sexe", render: (student) => student.sexe || "-", align: "center" },
    { header: "Classe", render: (student) => formatStudentPdfClassName(student) || "-" },
    { header: "Téléphone", render: (student) => student.phone || "-" },
  ];
  if (showOptionColumn) {
    studentColumns.splice(4, 0, { header: "Option", render: (student) => student.option || "-" });
  }
  await renderAcadPdfPreview({
    filename: `eleves-${year.name}.pdf`,
    title: "Liste des élèves",
    school,
    year,
    subtitle: `Filtres appliqués : ${filters.join(" | ")}`,
    sections: [
      pdfSection(
        "Élèves",
        pdfTable(
          studentColumns,
          students,
          "Aucun élève ne correspond aux filtres appliqués.",
          {
            footerHtml: `
              <tr>
                <td colspan="${totalLabelColspan}">Total élèves</td>
                <td class="align-right">${students.length}</td>
              </tr>
            `,
          },
        ),
      ),
    ],
  });
}

export function calculateStudentAge(birthDate?: string) {
  if (!birthDate) return null;
  const date = new Date(`${birthDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const birthdayThisYear = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (today < birthdayThisYear) age -= 1;
  return age >= 0 ? age : null;
}

export async function exportAgeHomogeneityPdf(school: School, year: SchoolYear, students: Student[]) {
  type StudentAgeDetailRow = {
    index: number;
    student: Student;
    age: number | null;
    theoreticalAge: number | null;
    situation: "Âge normal" | "En avance" | "En retard" | "Non déterminé";
    observation: string;
  };
  type AgeHomogeneitySummaryRow = {
    index: number;
    className: SchoolClass;
    minAge: number | null;
    maxAge: number | null;
    averageAge: number | null;
    normal: number;
    early: number;
    late: number;
    total: number;
    homogeneityRate: number;
  };

  const theoreticalAgeByClass = new Map<SchoolClass, number>([
    ["Maternelle 1", 3],
    ["Maternelle 2", 4],
    ["Maternelle 3", 5],
    ["1ère Primaire", 6],
    ["2ème Primaire", 7],
    ["3ème Primaire", 8],
    ["4ème Primaire", 9],
    ["5ème Primaire", 10],
    ["6ème Primaire", 11],
    ["7ème CTEB", 12],
    ["8ème CTEB", 13],
    ["1ère Humanité", 14],
    ["2ème Humanité", 15],
    ["3ème Humanité", 16],
    ["4ème Humanité", 17],
  ]);
  const schoolOrderByClass = new Map<SchoolClass, { section: number; level: number }>([
    ["Maternelle 1", { section: 1, level: 1 }],
    ["Maternelle 2", { section: 1, level: 2 }],
    ["Maternelle 3", { section: 1, level: 3 }],
    ["1ère Primaire", { section: 2, level: 1 }],
    ["2ème Primaire", { section: 2, level: 2 }],
    ["3ème Primaire", { section: 2, level: 3 }],
    ["4ème Primaire", { section: 2, level: 4 }],
    ["5ème Primaire", { section: 2, level: 5 }],
    ["6ème Primaire", { section: 2, level: 6 }],
    ["7ème CTEB", { section: 3, level: 1 }],
    ["8ème CTEB", { section: 3, level: 2 }],
    ["1ère Humanité", { section: 3, level: 3 }],
    ["2ème Humanité", { section: 3, level: 4 }],
    ["3ème Humanité", { section: 3, level: 5 }],
    ["4ème Humanité", { section: 3, level: 6 }],
  ]);
  const sortedStudents = [...students].sort((a, b) => {
    const aOrder = schoolOrderByClass.get(a.className) ?? { section: 99, level: 99 };
    const bOrder = schoolOrderByClass.get(b.className) ?? { section: 99, level: 99 };
    const sectionDiff = aOrder.section - bOrder.section;
    if (sectionDiff !== 0) return sectionDiff;
    const levelDiff = aOrder.level - bOrder.level;
    if (levelDiff !== 0) return levelDiff;
    return `${a.nom} ${a.postnom} ${a.prenom}`.localeCompare(`${b.nom} ${b.postnom} ${b.prenom}`, "fr");
  });
  const detailRows: StudentAgeDetailRow[] = sortedStudents.map((student, index) => {
    const age = calculateStudentAge(student.birthDate);
    const theoreticalAge = theoreticalAgeByClass.get(student.className) ?? null;
    const situation =
      age === null || theoreticalAge === null
        ? "Non déterminé"
        : age < theoreticalAge
          ? "En avance"
          : age > theoreticalAge
            ? "En retard"
            : "Âge normal";
    const observation =
      age === null
        ? "Date de naissance absente ou invalide"
        : theoreticalAge === null
          ? "Âge théorique non défini"
          : situation === "Âge normal"
            ? "Conforme"
            : situation;
    return { index: index + 1, student, age, theoreticalAge, situation, observation };
  });
  const summaryRows: AgeHomogeneitySummaryRow[] = CLASSES.map((className) => {
    const classRows = detailRows.filter((row) => row.student.className === className);
    if (classRows.length === 0) return null;
    const knownAgeRows = classRows.filter((row) => row.age !== null);
    const ages = knownAgeRows.map((row) => row.age as number);
    const normal = classRows.filter((row) => row.situation === "Âge normal").length;
    const early = classRows.filter((row) => row.situation === "En avance").length;
    const late = classRows.filter((row) => row.situation === "En retard").length;
    return {
      index: 0,
      className,
      minAge: ages.length ? Math.min(...ages) : null,
      maxAge: ages.length ? Math.max(...ages) : null,
      averageAge: ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : null,
      normal,
      early,
      late,
      total: classRows.length,
      homogeneityRate: knownAgeRows.length ? Math.round((normal / knownAgeRows.length) * 100) : 0,
    };
  })
    .filter((row): row is Omit<AgeHomogeneitySummaryRow, "index"> & { index: number } => Boolean(row))
    .map((row, index) => ({ ...row, index: index + 1 }));
  const missingBirthDateCount = detailRows.filter((row) => row.age === null).length;
  const formatAge = (age: number | null) => (age === null ? "—" : `${age} ans`);
  const formatAverageAge = (age: number | null) => (age === null ? "—" : `${age.toFixed(1).replace(".", ",")} ans`);

  await renderAcadPdfPreview({
    filename: `homogeneite-age-${year.name}.pdf`,
    title: "Tableau d'homogénéité d'âge",
    school,
    year,
    subtitle: "Synthèse et détail de l'homogénéité d'âge scolaire",
    sections: [
      pdfSection(
        "Informations de calcul",
        pdfInfoGrid([
          { label: "Élèves analysés", value: detailRows.length },
          { label: "Classes représentées", value: summaryRows.length },
          { label: "Date de calcul", value: new Intl.DateTimeFormat("fr-FR").format(new Date()) },
          {
            label: "Données manquantes",
            value: missingBirthDateCount > 0 ? `${missingBirthDateCount} élève(s) sans date de naissance exploitable` : "Aucune",
          },
        ]),
      ),
      pdfSection(
        "Synthèse de l'homogénéité d'âge scolaire par classe",
        pdfTable(
          [
            { header: "N°", render: (row) => row.index, align: "center" },
            { header: "Classe", render: (row) => row.className },
            { header: "Effectif total", render: (row) => row.total, align: "center" },
            { header: "Âge minimum", render: (row) => formatAge(row.minAge), align: "center" },
            { header: "Âge maximum", render: (row) => formatAge(row.maxAge), align: "center" },
            { header: "Âge moyen", render: (row) => formatAverageAge(row.averageAge), align: "center" },
            { header: "Élèves à l'âge normal", render: (row) => row.normal, align: "center" },
            { header: "Élèves en avance", render: (row) => row.early, align: "center" },
            { header: "Élèves en retard", render: (row) => row.late, align: "center" },
            { header: "Taux d'homogénéité", render: (row) => `${row.homogeneityRate}%`, align: "center" },
          ],
          summaryRows,
          "Aucune donnée d'âge exploitable pour les élèves sélectionnés.",
        ),
      ),
      pdfSection(
        "Détail de l'homogénéité d'âge scolaire par élève",
        pdfTable(
          [
            { header: "N°", render: (row) => row.index, align: "center" },
            { header: "Matricule", render: (row) => row.student.matricule || "—" },
            { header: "Nom et prénom", render: (row) => `${row.student.nom} ${row.student.postnom} ${row.student.prenom}`.replace(/\s+/g, " ").trim() || "—" },
            { header: "Sexe", render: (row) => row.student.sexe, align: "center" },
            { header: "Date de naissance", render: (row) => row.student.birthDate || "—", align: "center" },
            { header: "Âge", render: (row) => formatAge(row.age), align: "center" },
            { header: "Classe", render: (row) => formatStudentClassName(row.student) },
            { header: "Âge théorique", render: (row) => formatAge(row.theoreticalAge), align: "center" },
            { header: "Situation", render: (row) => row.situation },
            { header: "Observation", render: (row) => row.observation },
          ],
          detailRows,
          "Aucun élève ne correspond aux filtres appliqués.",
        ),
        { pageBreakBefore: true },
      ),
    ],
  });
}
