import type { AppUser, PersonnelProfile } from "../../types";
import { isArchivedPersonnel, personnelIdentity, personnelRoleLabels } from "../../services/personnel";
import { schoolSectionLabels } from "../../utils/schoolConfig";
import { userSectionIds } from "../../utils/userSections";

const shown = (value: unknown) => value === undefined || value === null || value === "" ? "Non renseigné" : String(value);
const dateShown = (value: unknown) => {
  if (!value) return "Non renseigné";
  const timestamp = value as { toDate?: () => Date; toMillis?: () => number };
  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : typeof timestamp.toMillis === "function" ? new Date(timestamp.toMillis()) : new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? "Non renseigné" : date.toLocaleDateString("fr-FR");
};

export function PersonnelProfileReadOnly({ personnel, profile, schoolName }: { personnel: AppUser; profile?: PersonnelProfile; schoolName?: string }) {
  const identity = personnelIdentity(personnel, profile);
  const detailSections: Array<[string, Array<[string, unknown]>]> = [
    ["IDENTIFICATION", [["Matricule", profile?.matricule], ["Nom", identity.lastName], ["Postnom", identity.middleName], ["Prénom", identity.firstName], ["Sexe", profile?.gender], ["Date de naissance", dateShown(profile?.birthDate)], ["Lieu de naissance", profile?.birthPlace]]],
    ["COORDONNÉES", [["Téléphone", personnel.phone], ["E-mail", personnel.email], ["Adresse", profile?.address ?? personnel.address]]],
    ["SITUATION PROFESSIONNELLE", [["Fonction", profile?.jobTitle ?? personnelRoleLabels[personnel.role as keyof typeof personnelRoleLabels]], ...(schoolName ? [["École", schoolName] as [string, unknown]] : []), ["Date d’engagement", dateShown(profile?.engagementDate)], ["Type de contrat", profile?.contractType], ["Sections", userSectionIds(personnel).map((section) => schoolSectionLabels[section]).join(", ")], ["Statut", isArchivedPersonnel(personnel) ? "Archivé" : "Actif"]]],
    ["FORMATION ET QUALIFICATIONS", [["Niveau d’études", profile?.educationLevel], ["Diplôme", profile?.diploma], ["Spécialité", profile?.specialty], ["Établissement de formation", profile?.trainingInstitution], ["Année d’obtention", profile?.graduationYear]]],
    ["INFORMATIONS COMPLÉMENTAIRES", [["Personne à contacter", profile?.emergencyContactName], ["Lien avec la personne", profile?.emergencyContactRelationship], ["Téléphone", profile?.emergencyContactPhone]]],
    ["OBSERVATIONS", [["Observations", profile?.observations]]],
    ["INFORMATIONS SYSTÈME — LECTURE SEULE", [["Date d’établissement de la fiche", dateShown(personnel.createdAt)]]],
  ];
  return <>
    {profile?.photoUrl && <img src={profile.photoUrl} alt={`Photo de ${personnel.name}`} className="mx-auto h-32 w-28 rounded border object-contain"/>}
    <div className="grid gap-4 text-sm">{detailSections.map(([title, rows]) => <section key={title} className="rounded bg-slate-50 p-4"><h3 className="mb-3 font-bold text-ink">{title}</h3><dl className="grid gap-3 sm:grid-cols-2">{rows.map(([label, item]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="break-words whitespace-pre-wrap">{shown(item)}</dd></div>)}</dl></section>)}</div>
  </>;
}
