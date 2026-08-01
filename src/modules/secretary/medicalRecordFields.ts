export type MedicalRecordInput = {
  bloodGroup: string;
  rhesus: string;
  height: string;
  weight: string;
  medicalHistory: string;
  allergies: string;
  chronicDiseases: string;
  currentTreatments: string;
  disabilityOrSpecialNeed: string;
  vaccinations: string;
  medicalObservations: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  attendingPhysician: string;
  physicianPhone: string;
  referenceHealthCenter: string;
};

export type MedicalRecordField = {
  key: keyof MedicalRecordInput;
  label: string;
  control: "input" | "textarea";
  required?: boolean;
};

export type MedicalRecordSection = {
  title: string;
  fields: readonly MedicalRecordField[];
};

export const emptyMedicalRecordInput: MedicalRecordInput = {
  bloodGroup: "",
  rhesus: "",
  height: "",
  weight: "",
  medicalHistory: "",
  allergies: "",
  chronicDiseases: "",
  currentTreatments: "",
  disabilityOrSpecialNeed: "",
  vaccinations: "",
  medicalObservations: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  attendingPhysician: "",
  physicianPhone: "",
  referenceHealthCenter: "",
};

export const medicalRecordSections: readonly MedicalRecordSection[] = [
  {
    title: "Informations médicales",
    fields: [
      { key: "bloodGroup", label: "Groupe sanguin", control: "input", required: true },
      { key: "rhesus", label: "Rhésus (optionnel)", control: "input" },
      { key: "height", label: "Taille", control: "input" },
      { key: "weight", label: "Poids", control: "input" },
      { key: "medicalHistory", label: "Antécédents médicaux", control: "textarea" },
      { key: "allergies", label: "Allergies", control: "textarea" },
      { key: "chronicDiseases", label: "Maladies chroniques", control: "textarea" },
      { key: "currentTreatments", label: "Traitements en cours", control: "textarea" },
      { key: "disabilityOrSpecialNeed", label: "Handicap ou besoin particulier", control: "textarea" },
      { key: "vaccinations", label: "Vaccinations", control: "textarea" },
      { key: "medicalObservations", label: "Observations médicales", control: "textarea" },
    ],
  },
  {
    title: "Urgence",
    fields: [
      { key: "emergencyContactName", label: "Contact d'urgence", control: "input", required: true },
      { key: "emergencyContactPhone", label: "Téléphone du contact d'urgence", control: "input", required: true },
      { key: "emergencyContactRelationship", label: "Lien avec l'élève", control: "input", required: true },
    ],
  },
  {
    title: "Suivi médical",
    fields: [
      { key: "attendingPhysician", label: "Médecin traitant", control: "input" },
      { key: "physicianPhone", label: "Téléphone du médecin", control: "input" },
      { key: "referenceHealthCenter", label: "Centre de santé de référence", control: "input" },
    ],
  },
] as const;

export const requiredMedicalRecordFields: Array<keyof MedicalRecordInput> = medicalRecordSections.flatMap((section) => section.fields).filter((field) => field.required).map((field) => field.key);

export function normalizeMedicalRecordInput(value?: Partial<MedicalRecordInput>): MedicalRecordInput {
  return Object.fromEntries(
    Object.keys(emptyMedicalRecordInput).map((key) => [key, String(value?.[key as keyof MedicalRecordInput] ?? "")]),
  ) as MedicalRecordInput;
}

export function formatMedicalRecordValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(", ") || "Non renseigné";
  return String(value ?? "").trim() || "Non renseigné";
}
