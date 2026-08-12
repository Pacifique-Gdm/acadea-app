import type { Student } from "../../types";
import { escapePdfHtml, formatPdfDate, pdfInfoGrid, pdfSection } from "../../utils/pdf";
import { formatStudentClassName } from "../../utils/studentClasses";
import { formatMedicalRecordValue, medicalRecordSections } from "./medicalRecordFields";
import type { StudentMedicalRecord } from "./secretaryTypes";

function safeDate(value?: string) {
  return value ? formatPdfDate(value) : "Non renseigné";
}

export function medicalRecordPdfSections(student: Student, record: StudentMedicalRecord) {
  const fullName = `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();
  const photo = student.photoUrl
    ? `<img src="${escapePdfHtml(student.photoUrl)}" alt="Photo de l'élève" style="width:88px;height:104px;object-fit:cover;border:1px solid #cbd5e1;border-radius:4px" />`
    : `<div style="width:88px;height:104px;border:1px solid #cbd5e1;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:10px">PHOTO</div>`;
  const identity = `<div style="display:grid;grid-template-columns:100px 1fr;gap:14px;align-items:start">${photo}${pdfInfoGrid([
    { label: "Nom complet", value: fullName },
    { label: "Matricule", value: student.matricule },
    { label: "Classe", value: formatStudentClassName(student) },
    { label: "Sexe", value: student.sexe === "F" ? "Féminin" : "Masculin" },
    { label: "Date de naissance", value: safeDate(student.birthDate) },
  ])}</div>`;
  const medicalSections = medicalRecordSections.map((section) => pdfSection(section.title.toUpperCase(), pdfInfoGrid(section.fields.map((field) => ({
    label: field.label,
    value: formatMedicalRecordValue(record[field.key]),
  })))));
  const sections = [
    pdfSection("INFORMATIONS DE L’ÉLÈVE", identity),
    ...medicalSections,
    pdfSection("SUIVI DU DOCUMENT", pdfInfoGrid([
      { label: "Date de création", value: safeDate(record.createdAt) },
      { label: "Dernière mise à jour", value: safeDate(record.updatedAt) },
    ])),
  ];
  return [`<div class="medical-record-pdf">${sections.join("")}</div>`];
}
