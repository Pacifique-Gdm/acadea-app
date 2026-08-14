import type { AppUser, PersonnelProfile, School } from "../types";
import { isArchivedPersonnel, personnelRoleLabels } from "../services/personnel";
import { schoolSectionLabels } from "./schoolConfig";
import { userSectionIds } from "./userSections";
import { escapePdfHtml, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "./pdf";

function personnelDate(value?: string) {
  if (!value) return "Non renseigné";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Non renseigné" : date.toLocaleDateString("fr-FR");
}

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

export async function printPersonnelProfilePdf(school: School, personnel: AppUser, profileOrPrintedAt?: PersonnelProfile | Date, requestedPrintedAt = new Date()) {
  const profile = profileOrPrintedAt instanceof Date ? undefined : profileOrPrintedAt;
  const printedAt = profileOrPrintedAt instanceof Date ? profileOrPrintedAt : requestedPrintedAt;
  const role = personnelRoleLabels[personnel.role as keyof typeof personnelRoleLabels] ?? personnel.role;
  const sections = userSectionIds(personnel).map((section) => schoolSectionLabels[section]).join(", ") || "Non renseignées";
  return renderAcadPdfPreview({
    filename: `fiche-personnel-${personnel.id}.pdf`,
    title: "FICHE INDIVIDUELLE DU PERSONNEL",
    school,
    generatedAt: printedAt,
    sections: [profile?.photoUrl ? `<div class="personnel-photo"><img src="${escapePdfHtml(profile.photoUrl)}" alt="Photo de ${escapePdfHtml(personnel.name)}" /></div>` : "", pdfSection("Identification", pdfInfoGrid([
      { label: "Matricule", value: profile?.matricule || "Non renseigné" }, { label: "Nom complet", value: personnel.name },
      { label: "Sexe", value: profile?.gender || "Non renseigné" }, { label: "Date de naissance", value: profile?.birthDate || "Non renseigné" },
      { label: "Lieu de naissance", value: profile?.birthPlace || "Non renseigné" }, { label: "Adresse", value: profile?.address || "Non renseigné" },
      { label: "Fonction", value: role },
      { label: "Sections", value: sections }, { label: "Téléphone", value: personnel.phone || "Non renseigné" },
      { label: "E-mail", value: personnel.email || "Non renseigné" },
      { label: "Date d’engagement", value: profile?.engagementDate || "Non renseigné" }, { label: "Type de contrat", value: profile?.contractType || "Non renseigné" },
      { label: "Niveau d’études", value: profile?.educationLevel || "Non renseigné" }, { label: "Diplôme", value: profile?.diploma || "Non renseigné" },
      { label: "Spécialité", value: profile?.specialty || "Non renseigné" }, { label: "Établissement de formation", value: profile?.trainingInstitution || "Non renseigné" },
      { label: "Année d’obtention", value: profile?.graduationYear || "Non renseigné" }, { label: "Contact d’urgence", value: profile?.emergencyContactName || "Non renseigné" },
      { label: "Lien avec le personnel", value: profile?.emergencyContactRelationship || "Non renseigné" }, { label: "Téléphone d’urgence", value: profile?.emergencyContactPhone || "Non renseigné" },
      { label: "Observations", value: profile?.observations || "Non renseigné" },
      { label: "Statut", value: isArchivedPersonnel(personnel) ? "Archivé" : "Actif" },
      { label: "École", value: school.name },
      { label: "Date d’établissement", value: personnelDate(personnel.createdAt) },
    ]))],
    singlePageFit: !profile?.observations || profile.observations.length < 500,
  });
}
