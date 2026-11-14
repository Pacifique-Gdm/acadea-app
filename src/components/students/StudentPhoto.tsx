import { useEffect, useState, type ReactNode } from "react";
import type { Student } from "../../types";
import { loadStudentPhotoUrl } from "../../services/studentPhotoStorage";

/** Photo Storage d'abord (lue avec l'identité de l'utilisateur), sinon l'ancienne
 * photo de la fiche, sinon le contenu de remplacement (initiale). */
export function useStudentPhotoSource(student: Pick<Student, "photoUrl" | "photoPath" | "photoStorageUrl">) {
  const [stored, setStored] = useState<{ path: string; url: string }>();
  const path = student.photoPath ?? "";
  useEffect(() => {
    if (!path) return undefined;
    let active = true;
    loadStudentPhotoUrl(path).then((url) => { if (active) setStored({ path, url }); }).catch(() => undefined);
    return () => { active = false; };
  }, [path]);
  if (path && stored?.path === path) return stored.url;
  return student.photoStorageUrl || student.photoUrl || "";
}

export function StudentPhoto({ student, className, fallback }: { student: Pick<Student, "photoUrl" | "photoPath" | "photoStorageUrl">; className: string; fallback: ReactNode }) {
  const source = useStudentPhotoSource(student);
  return source ? <img src={source} alt="" className={className} /> : <>{fallback}</>;
}
