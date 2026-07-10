import type { School, SchoolYear } from "../types";
import {
  fallbackText,
  getParentsDirectoryEntryChildren,
  type ParentsDirectoryEntry,
} from "./parentsDirectory";
import { pdfInfoGrid, pdfTable, renderAcadPdfPreview } from "./pdf";

type PrintParentsDirectoryPdfOptions = {
  school: School;
  year: SchoolYear;
  entries: ParentsDirectoryEntry[];
  classFilterLabel?: string;
  printedAt?: Date;
};

type ParentsDirectoryPdfRow = {
  index: number;
  parentName: string;
  phone: string;
  email: string;
  childrenCount: number;
  childrenNames: string;
  classLabels: string;
};

export async function printParentsDirectoryPdf({
  school,
  year,
  entries,
  classFilterLabel,
  printedAt = new Date(),
}: PrintParentsDirectoryPdfOptions) {
  const rows: ParentsDirectoryPdfRow[] = entries.map((entry, index) => {
    const children = getParentsDirectoryEntryChildren(entry, classFilterLabel);
    const childNames = Array.from(new Set(children.map((child) => child.displayName).filter(Boolean)));
    const classLabels = Array.from(new Set(children.map((child) => child.classLabel).filter(Boolean)));

    return {
      index: index + 1,
      parentName: fallbackText(entry.parent.fullName),
      phone: fallbackText(entry.parent.phone),
      email: fallbackText(entry.parent.email),
      childrenCount: children.length,
      childrenNames: childNames.join(", ") || "Non renseigné",
      classLabels: classLabels.join(", ") || "Non renseigné",
    };
  });

  await renderAcadPdfPreview({
    filename: `parents-tuteurs-${year.name}.pdf`,
    title: "Liste des Parents / Tuteurs",
    school,
    year,
    subtitle: classFilterLabel ? `Classe : ${classFilterLabel}` : "Toutes les classes",
    generatedAt: printedAt,
    sections: [
      pdfInfoGrid([
        { label: "Année scolaire", value: year.name },
        { label: "Classe filtrée", value: classFilterLabel || "Toutes les classes" },
        {
          label: "Date et heure d'impression",
          value: new Intl.DateTimeFormat("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(printedAt),
        },
      ]),
      pdfTable(
        [
          { header: "N°", render: (row) => row.index, align: "center" },
          { header: "Parent / Tuteur", render: (row) => row.parentName },
          { header: "Téléphone", render: (row) => row.phone },
          { header: "E-mail", render: (row) => row.email },
          { header: "Nombre d'enfants", render: (row) => row.childrenCount, align: "center" },
          { header: "Enfants liés", render: (row) => row.childrenNames },
          { header: "Classe(s)", render: (row) => row.classLabels },
        ],
        rows,
        "Aucun parent ou tuteur ne correspond aux filtres appliqués.",
      ),
    ],
  });
}
