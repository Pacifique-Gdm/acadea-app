import type { AppUser, School } from "../types";
import { isArchivedPersonnel, personnelRoleLabels } from "../services/personnel";
import { schoolSectionLabels } from "./schoolConfig";
import { userSectionIds } from "./userSections";
import { pdfInfoGrid, pdfTable, renderAcadPdfPreview } from "./pdf";

export async function printPersonnelListPdf(school: School, personnel: AppUser[], status: "active" | "archived", printedAt = new Date()) {
  const archived = status === "archived";
  return renderAcadPdfPreview({
    filename: `liste-personnel-${archived ? "archive" : "actif"}.pdf`, title: `Liste du personnel ${archived ? "archivé" : "actif"}`, school, generatedAt: printedAt,
    sections: [pdfTable([
      { header: "Nom", render: (item) => item.name },
      { header: "Fonction", render: (item) => personnelRoleLabels[item.role as keyof typeof personnelRoleLabels] ?? item.role },
      { header: "Sections", render: (item) => userSectionIds(item).map((section) => schoolSectionLabels[section]).join(", ") || "Non renseignées" },
      { header: "Téléphone", render: (item) => item.phone || "Non renseigné" },
      { header: "E-mail", render: (item) => item.email || "Non renseigné" },
      { header: "Statut", render: () => archived ? "Archivé" : "Actif" },
    ], personnel, "Aucun personnel correspondant au filtre sélectionné.")],
  });
}

export async function printPersonnelProfilePdf(school: School, personnel: AppUser, printedAt = new Date()) {
  const role = personnelRoleLabels[personnel.role as keyof typeof personnelRoleLabels] ?? personnel.role;
  const sections = userSectionIds(personnel).map((section) => schoolSectionLabels[section]).join(", ") || "Non renseignées";
  return renderAcadPdfPreview({
    filename: `fiche-personnel-${personnel.id}.pdf`,
    title: "Fiche individuelle du personnel",
    school,
    generatedAt: printedAt,
    sections: [pdfInfoGrid([
      { label: "Identité", value: personnel.name }, { label: "Fonction", value: role },
      { label: "Sections", value: sections }, { label: "Téléphone", value: personnel.phone || "Non renseigné" },
      { label: "E-mail", value: personnel.email || "Non renseigné" },
      { label: "Statut", value: isArchivedPersonnel(personnel) ? "Archivé" : "Actif" },
      { label: "École", value: school.name },
      { label: "Date de création", value: personnel.createdAt ? new Date(personnel.createdAt).toLocaleDateString("fr-FR") : "Non renseigné" },
    ])],
    singlePageFit: true,
  });
}
