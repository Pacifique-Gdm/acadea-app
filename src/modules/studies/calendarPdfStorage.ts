import { deleteObject, getBlob, ref, uploadBytes } from "firebase/storage";
import { auth, storage } from "../../firebase";
import type { AppUser, School, SchoolYear } from "../../types";
import type { CalendarPdfSource } from "./schoolCalendar";

const maxBytes = 10 * 1024 * 1024;
const pathFor = (schoolId: string, yearId: string, fileId: string) => `school-calendars/${schoolId}/${yearId}/${fileId}.pdf`;

export async function uploadCalendarPdf(input: { user: AppUser; school: School; year: SchoolYear; file: File; pageCount: number }): Promise<CalendarPdfSource> {
  const { user, school, year, file, pageCount } = input;
  if (!storage || !auth?.currentUser || auth.currentUser.uid !== user.id) throw new Error("Session de stockage indisponible.");
  if (user.role !== "study_director" || user.schoolId !== school.id || year.schoolId !== school.id || school.activeSchoolYearId !== year.id || user.active === false || user.status === "inactive") throw new Error("Import PDF réservé au Directeur des études de l'année active.");
  if (file.size <= 0 || file.size > maxBytes || (file.type && file.type !== "application/pdf") || pageCount < 1 || pageCount > 30) throw new Error("PDF invalide ou trop volumineux.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Signature PDF invalide.");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const name = file.name.trim().slice(0, 120) || "calendrier.pdf";
  const path = pathFor(school.id, year.id, crypto.randomUUID());
  await uploadBytes(ref(storage, path), file, { contentType: "application/pdf", customMetadata: { schoolId: school.id, schoolYearId: year.id, uploadedBy: user.id, originalName: name } });
  return { path, name, size: file.size, pageCount, sha256, uploadedAt: new Date().toISOString(), uploadedBy: user.id };
}

export async function removeUnreferencedCalendarPdf(source: CalendarPdfSource, schoolId: string, yearId: string): Promise<void> {
  if (!storage || !source.path.startsWith(`school-calendars/${schoolId}/${yearId}/`)) throw new Error("Chemin PDF hors périmètre.");
  await deleteObject(ref(storage, source.path));
}

export async function downloadCalendarPdf(source: CalendarPdfSource, schoolId: string, yearId: string): Promise<void> {
  if (!storage || !source.path.startsWith(`school-calendars/${schoolId}/${yearId}/`)) throw new Error("Chemin PDF hors périmètre.");
  const blob = await getBlob(ref(storage, source.path));
  if (blob.size !== source.size) throw new Error("Le PDF conservé ne correspond plus au document importé.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  const sha256 = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (sha256 !== source.sha256) throw new Error("Le PDF conservé ne correspond plus au document importé.");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = source.name;
    document.body.append(link);
    link.click();
    link.remove();
  } finally { window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000); }
}
