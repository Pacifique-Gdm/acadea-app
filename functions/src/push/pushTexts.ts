import type { Firestore } from "firebase-admin/firestore";

/** Lot 25 — textes des notifications push, rédigés au même endroit pour toute l'application.
 * Ils indiquent l'école et le prénom de l'enfant, jamais de montant, de motif ni de détail sensible
 * (ils s'affichent sur l'écran verrouillé du téléphone). */
export type PushContext = { schoolName?: string; firstName?: string; sex?: string };
export type PushKind =
  | "payment_recorded" | "payment_corrected" | "payment_cancelled"
  | "student_absent" | "student_late" | "discipline_incident_created"
  | "announcement_published" | "grades_published";

const clean = (value: unknown, max = 120) => {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  // Jamais « undefined », « null » ni vide dans un texte affiché.
  if (!text || /^(undefined|null|nan)$/i.test(text)) return "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

function school(context: PushContext) { return clean(context.schoolName, 80) || "Acadéa"; }
function child(context: PushContext) { return clean(context.firstName, 60) || "votre enfant"; }
/** Accord selon le sexe connu de l'élève, sinon forme « (e) ». */
function agree(context: PushContext, masculine: string, feminine: string, neutral: string) {
  return context.sex === "M" ? masculine : context.sex === "F" ? feminine : neutral;
}

export function pushText(kind: PushKind, context: PushContext, extra: { title?: unknown } = {}) {
  const s = school(context), c = child(context);
  switch (kind) {
    case "payment_recorded": return { title: `${s} — Paiement reçu`, body: `Un paiement a été enregistré pour ${c}. Touchez pour voir le reçu.` };
    case "payment_corrected": return { title: `${s} — Paiement corrigé`, body: `Un paiement de ${c} a été corrigé. Touchez pour voir le détail.` };
    case "payment_cancelled": return { title: `${s} — Paiement annulé`, body: `Un paiement de ${c} a été annulé. Touchez pour voir le détail.` };
    case "student_absent": return { title: `${s} — Absence`, body: `${upperFirst(c)} a été ${agree(context, "noté absent", "notée absente", "noté(e) absent(e)")} aujourd'hui.` };
    case "student_late": return { title: `${s} — Retard`, body: `${upperFirst(c)} est ${agree(context, "arrivé", "arrivée", "arrivé(e)")} en retard aujourd'hui.` };
    case "discipline_incident_created": return { title: `${s} — Information discipline`, body: `Une information concernant ${c} est disponible.` };
    case "announcement_published": return { title: `${s} — Nouvelle annonce`, body: clean(extra.title, 160) || "Une nouvelle annonce est disponible." };
    case "grades_published": return { title: `${s} — Nouvelles notes`, body: `Les notes de ${c} ont été publiées.` };
  }
}

/** « Nouveau message — Nom » / « Objet : … » ; « Équipe ACADÉA » pour le Super administrateur. */
export function messagePushText(message: { senderName?: unknown; senderRole?: unknown; subject?: unknown } | null | undefined) {
  const sender = message?.senderRole === "super_admin" ? "Équipe ACADÉA" : clean(message?.senderName, 80) || "Acadéa";
  const subject = clean(message?.subject, 120);
  return { title: `Nouveau message — ${sender}`, body: subject ? `Objet : ${subject}` : "Touchez pour lire le message." };
}

function upperFirst(text: string) { return text ? text[0]!.toUpperCase() + text.slice(1) : text; }

/** Lit le nom de l'école et le prénom de l'élève (lecture seule, valeurs vides si absentes). */
export async function loadPushContext(database: Firestore, schoolId: unknown, studentId: unknown): Promise<PushContext> {
  const [schoolSnapshot, studentSnapshot] = await Promise.all([
    typeof schoolId === "string" && schoolId ? database.doc(`schools/${schoolId}`).get() : Promise.resolve(null),
    typeof studentId === "string" && studentId ? database.doc(`students/${studentId}`).get() : Promise.resolve(null),
  ]);
  const schoolData = schoolSnapshot?.exists ? schoolSnapshot.data() ?? {} : {};
  const student = studentSnapshot?.exists ? studentSnapshot.data() ?? {} : {};
  return { schoolName: clean(schoolData.name, 80), firstName: studentDisplayName(student), sex: typeof student.sexe === "string" ? student.sexe : undefined };
}

/** Prénom de l'élève s'il existe ; sinon son nom complet comme dans Acadéa (nom et post-nom). */
export function studentDisplayName(student: Record<string, unknown>) {
  const firstName = clean(student.prenom, 60);
  if (firstName) return firstName;
  return clean([clean(student.nom, 60), clean(student.postnom, 60)].filter(Boolean).join(" "), 80) || clean(student.name ?? student.fullName, 80);
}
