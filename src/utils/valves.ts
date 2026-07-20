import type { ParentProfile, SchoolClass, SchoolSection, Student, ValvePublication, ValveVisibility } from "../types";
import { CLASSES } from "../types";
import { formatValveAttachmentSize, MAX_VALVE_ATTACHMENTS, MAX_VALVE_ATTACHMENTS_TOTAL_SIZE, validateValveAttachments } from "./valvesMedia";

const valveClassSeparator = "::option::";

type LegacyValveVisibility = ValveVisibility | "parents" | "all" | "staff";

export type ValveClassChoice = {
  value: string;
  label: string;
};

export type ValveAttachmentDraft = {
  name: string;
  type: string;
  dataUrl?: string;
  url?: string;
  path?: string;
  size: number;
};

export function normalizeValveVisibility(value: LegacyValveVisibility): ValveVisibility {
  if (value === "parents" || value === "all" || value === "staff") return "all_parents";
  return value;
}

function getValveClassSection(className: SchoolClass): SchoolSection {
  if (className.includes("Maternelle")) return "maternelle";
  if (className.includes("Humanité")) return "secondaire";
  return "primaire";
}

function valveClassKey(className: SchoolClass, option?: string) {
  const normalizedOption = option?.trim();
  return normalizedOption ? `${className}${valveClassSeparator}${normalizedOption}` : className;
}

function valveClassNameFromKey(target: string) {
  return target.split(valveClassSeparator)[0] as SchoolClass;
}

function valveClassOptionFromKey(target: string) {
  return target.includes(valveClassSeparator) ? target.split(valveClassSeparator).slice(1).join(valveClassSeparator) : "";
}

export function getValveStudentClassKey(student: Pick<Student, "className" | "option">) {
  return getValveClassSection(student.className) === "secondaire" ? valveClassKey(student.className, student.option) : student.className;
}

export function formatValveClassChoiceLabel(target: string) {
  const className = valveClassNameFromKey(target);
  const option = valveClassOptionFromKey(target);
  if (!option) return className;
  const classLabel = className.replace(/\s+Humanit[ée]s?$/i, "").trim();
  return `${classLabel || className} ${option}`;
}

export function buildValveClassChoices(students: Pick<Student, "className" | "option">[], selectedTarget?: string): ValveClassChoice[] {
  const choices = students
    .filter((student) => student.className)
    .map((student) => {
      const value = getValveStudentClassKey(student);
      return { value, label: formatValveClassChoiceLabel(value) };
    })
    .sort((first, second) => {
      const firstClassIndex = CLASSES.indexOf(valveClassNameFromKey(first.value));
      const secondClassIndex = CLASSES.indexOf(valveClassNameFromKey(second.value));
      if (firstClassIndex !== secondClassIndex) return firstClassIndex - secondClassIndex;
      return first.label.localeCompare(second.label, "fr");
    });
  const selectedChoice = selectedTarget ? [{ value: selectedTarget, label: formatValveClassChoiceLabel(selectedTarget) }] : [];
  return Array.from(new Map([...choices, ...selectedChoice].map((choice) => [choice.value, choice])).values());
}

export function parentCanViewValvePublication(
  publication: ValvePublication,
  parent: Pick<ParentProfile, "id" | "studentIds">,
  students: Pick<Student, "id" | "parentId" | "className" | "option">[],
) {
  const visibility = normalizeValveVisibility(publication.visibility as LegacyValveVisibility);
  if (visibility === "all_parents") return true;

  const children = students.filter((student) => student.parentId === parent.id || parent.studentIds.includes(student.id));
  if (visibility === "class") {
    if (!publication.targetClassKey) return false;
    return children.some((student) => getValveStudentClassKey(student) === publication.targetClassKey);
  }
  return children.some((student) => getValveClassSection(student.className) === visibility);
}

export function getValvePublicationParents(publication: ValvePublication, parents: ParentProfile[], students: Student[]) {
  const parentMap = new Map<string, ParentProfile>();
  parents.forEach((parent) => {
    if (parentCanViewValvePublication(publication, parent, students)) {
      parentMap.set(parent.id, parent);
    }
  });
  return Array.from(parentMap.values());
}

export function getApproximateValveDocumentSize(publication: ValvePublication) {
  return new TextEncoder().encode(JSON.stringify(publication)).length;
}

export function getValvePublicationErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("upload_inactivity_timeout") || normalized.includes("upload_timeout")) {
    return "L'envoi est interrompu faute de progression. Vérifiez votre connexion et réessayez.";
  }
  if (normalized.includes("too large") || normalized.includes("taille") || normalized.includes("quota") || normalized.includes("payload") || normalized.includes("bytes")) {
    return "Le fichier joint est trop volumineux pour être publié.";
  }
  if (normalized.includes("permission") || normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("denied")) {
    return "Permissions Firebase insuffisantes pour publier cette Valve.";
  }
  if (normalized.includes("network") || normalized.includes("offline") || normalized.includes("unavailable") || normalized.includes("failed to fetch")) {
    return "Erreur réseau pendant la publication. Vérifiez la connexion puis réessayez.";
  }
  if (normalized.includes("storage") || normalized.includes("bucket") || normalized.includes("object")) {
    return "Erreur Storage pendant l'envoi du fichier joint. Veuillez réessayer.";
  }
  if (normalized.includes("firestore") || normalized.includes("document") || normalized.includes("setdoc")) {
    return "Erreur Firestore pendant l'enregistrement de la publication. Veuillez réessayer.";
  }
  return fallback;
}

export function getPublicationAttachmentDrafts(publication: ValvePublication): ValveAttachmentDraft[] {
  if (publication.attachments?.length) {
    return publication.attachments.map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      url: attachment.url,
      path: attachment.path,
      size: attachment.size,
    }));
  }

  if (publication.attachmentUrl || publication.attachmentPath) {
    return [
      {
        name: publication.attachmentName ?? "document",
        type: publication.attachmentType ?? "application/octet-stream",
        url: publication.attachmentUrl,
        path: publication.attachmentPath,
        size: publication.attachmentSize ?? 0,
      },
    ];
  }

  if (publication.attachmentDataUrl) {
    return [
      {
        name: publication.attachmentName ?? "document",
        type: publication.attachmentType ?? "application/octet-stream",
        dataUrl: publication.attachmentDataUrl,
        size: publication.attachmentSize ?? 0,
      },
    ];
  }

  return [];
}

export function getPublicationDownloadAttachments(publication: ValvePublication) {
  const attachments = publication.attachments?.length
    ? publication.attachments.map((attachment) => ({ name: attachment.name, type: attachment.type, size: attachment.size, url: attachment.url }))
    : getPublicationAttachmentDrafts(publication).map((attachment) => ({ name: attachment.name, type: attachment.type, size: attachment.size, url: attachment.url ?? attachment.dataUrl }));
  return attachments.filter((attachment) => Boolean(attachment.url));
}

export function getValveAttachmentKey(attachment: Pick<ValveAttachmentDraft, "name" | "size" | "path" | "url">) {
  return `${attachment.path ?? attachment.url ?? ""}|${attachment.name.trim().toLowerCase()}|${attachment.size ?? 0}`;
}

export function validateValveAttachmentDrafts(attachments: ValveAttachmentDraft[]) {
  if (attachments.length > MAX_VALVE_ATTACHMENTS) {
    return `Vous pouvez joindre au maximum ${MAX_VALVE_ATTACHMENTS} fichiers par publication.`;
  }
  const totalSize = attachments.reduce((sum, attachment) => sum + (attachment.size ?? 0), 0);
  if (totalSize > MAX_VALVE_ATTACHMENTS_TOTAL_SIZE) {
    return `La taille totale des pièces jointes dépasse ${formatValveAttachmentSize(MAX_VALVE_ATTACHMENTS_TOTAL_SIZE)}.`;
  }
  return validateValveAttachments(attachments.filter((attachment) => attachment.dataUrl));
}
