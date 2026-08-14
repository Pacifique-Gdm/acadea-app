import type { AppUser, PersonnelProfile, School } from "../types";
import { isArchivedPersonnel, personnelIdentity, personnelRoleLabels } from "../services/personnel";
import { schoolSectionLabels } from "./schoolConfig";
import { userSectionIds } from "./userSections";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "./pdf";

function personnelDate(value: unknown) {
  if (!value) return "-";
  const timestamp = value as { toDate?: () => Date; toMillis?: () => number };
  const date = typeof timestamp.toDate === "function"
    ? timestamp.toDate()
    : typeof timestamp.toMillis === "function"
      ? new Date(timestamp.toMillis())
      : new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("fr-FR");
}

function value(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "-";
}

function lines(rows: Array<{ label: string; value: unknown }>) {
  return `<div class="personnel-lines">${rows.map((row) => `
    <div class="personnel-line">
      <span>${escapePdfHtml(row.label)} :</span>
      <strong>${escapePdfHtml(value(row.value))}</strong>
    </div>`).join("")}</div>`;
}

function genderLabel(gender?: PersonnelProfile["gender"]) {
  if (gender === "F") return "Féminin";
  if (gender === "M") return "Masculin";
  return gender || "-";
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
  const identity = personnelIdentity(personnel, profile);
  const role = personnelRoleLabels[personnel.role as keyof typeof personnelRoleLabels] ?? personnel.role;
  const sections = userSectionIds(personnel).map((section) => schoolSectionLabels[section]).join(", ") || "-";
  const birthDateAndPlace = [personnelDate(profile?.birthDate), value(profile?.birthPlace)].filter((item) => item !== "-").join(" à ") || "-";
  const photo = profile?.photoUrl
    ? `<img src="${escapePdfHtml(profile.photoUrl)}" alt="Photo du personnel" />`
    : '<span aria-label="Photo non renseignée">-</span>';

  return renderAcadPdfPreview({
    filename: `fiche-personnel-${personnel.id}.pdf`,
    title: "FICHE INDIVIDUELLE DU PERSONNEL",
    centerDocumentTitle: true,
    showGeneratedAt: false,
    school,
    generatedAt: printedAt,
    sections: [
      pdfSection("IDENTIFICATION", `<div class="personnel-identification-layout"><div>${lines([
        { label: "Matricule", value: profile?.matricule },
        { label: "Nom", value: identity.lastName },
        { label: "Postnom", value: identity.middleName },
        { label: "Prénom", value: identity.firstName },
        { label: "Sexe", value: genderLabel(profile?.gender) },
        { label: "Date et lieu de naissance", value: birthDateAndPlace },
      ])}</div><div class="personnel-photo-box"><span class="personnel-photo-label">PHOTO</span>${photo}</div></div>`, { className: "personnel-identification" }),
      pdfSection("COORDONNÉES", lines([
        { label: "Téléphone", value: personnel.phone },
        { label: "E-mail", value: personnel.email },
        { label: "Adresse", value: profile?.address ?? personnel.address },
      ]), { className: "personnel-coordinates" }),
      pdfSection("SITUATION PROFESSIONNELLE", lines([
        { label: "Fonction", value: profile?.jobTitle || role },
        { label: "Date d’engagement", value: personnelDate(profile?.engagementDate) },
        { label: "Type de contrat", value: profile?.contractType },
        { label: "Sections", value: sections },
        { label: "Statut", value: isArchivedPersonnel(personnel) ? "Archivé" : "Actif" },
      ]), { className: "personnel-professional" }),
      pdfSection("FORMATION ET QUALIFICATIONS", lines([
        { label: "Niveau d’études", value: profile?.educationLevel },
        { label: "Diplôme", value: profile?.diploma },
        { label: "Spécialité", value: profile?.specialty },
        { label: "Établissement", value: profile?.trainingInstitution },
        { label: "Année d’obtention", value: profile?.graduationYear },
      ]), { className: "personnel-training" }),
      pdfSection("INFORMATIONS COMPLÉMENTAIRES", lines([
        { label: "Personne à contacter", value: profile?.emergencyContactName },
        { label: "Lien avec la personne", value: profile?.emergencyContactRelationship },
        { label: "Téléphone", value: profile?.emergencyContactPhone },
      ]), { className: "personnel-additional" }),
      pdfSection("OBSERVATIONS", `<p class="personnel-observations">${profile?.observations ? escapePdfHtml(profile.observations) : "&nbsp;"}</p>`, { className: "personnel-observations-section" }),
      `<section class="personnel-closing">
        <p class="personnel-established-date"><strong>Date d’établissement de la fiche :</strong> ${escapePdfHtml(personnelDate(personnel.createdAt))}</p>
        <div class="personnel-signatures">
          <div><span>Signature du personnel</span></div>
          <div><span>Signature / Cachet de l’établissement</span></div>
        </div>
      </section>`,
    ],
    singlePageFit: !profile?.observations || profile.observations.length < 500,
  });
}
