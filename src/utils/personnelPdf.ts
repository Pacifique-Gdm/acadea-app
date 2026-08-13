import type { AppUser, School } from "../types";
import { isArchivedPersonnel, personnelRoleLabels } from "../services/personnel";
import { schoolSectionLabels } from "./schoolConfig";
import { userSectionIds } from "./userSections";
import { pdfInfoGrid, renderAcadPdfPreview } from "./pdf";

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
