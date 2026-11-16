import { useEffect } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, DisciplineSanction, ParentProfile, Student } from "../types";
import { userSectionIds } from "../utils/userSections";
import { disciplineParentScope, disciplineSanctionScope, disciplineStudentScope } from "../utils/disciplineSectionScope";

type RealtimeSchoolRecords = {
  students?: Student[];
  parents?: ParentProfile[];
  disciplineSanctions?: DisciplineSanction[];
};

export function useRealtimeSchoolRecords({
  user,
  schoolId,
  schoolYearId,
  includeStudents = true,
  onData,
  onError,
}: {
  user: AppUser | null;
  schoolId: string;
  schoolYearId: string;
  includeStudents?: boolean;
  onData: (data: RealtimeSchoolRecords) => void;
  onError?: (source: keyof RealtimeSchoolRecords, error: Error) => void;
}) {
  useEffect(() => {
    if (!db || !user || !schoolId || !schoolYearId) return;

    const unsubscribes: Array<() => void> = [];
    let active = true;
    let latestStudents: Student[] = [];
    let latestSanctions: DisciplineSanction[] = [];
    let latestParents: ParentProfile[] = [];
    const annualConstraints = [where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)];
    const assignedSections = userSectionIds(user);
    // La secrétaire écoute, comme le directeur, les élèves de l'année choisie
    // seulement (auparavant : toutes les années, photos comprises).
    const studentConstraints = user.role === "discipline_director" && assignedSections.length
        ? [...annualConstraints, where("section", "in", assignedSections)]
        : annualConstraints;
    const canReadStudents = ["school_admin", "cashier", "discipline_director", "secretary"].includes(user.role);
    const canReadParents = ["school_admin", "cashier", "discipline_director", "secretary"].includes(user.role);
    const canReadSanctions = ["school_admin", "discipline_director"].includes(user.role);

    if (canReadStudents && includeStudents) {
      unsubscribes.push(onSnapshot(
        query(collection(db, "students"), ...studentConstraints),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!active) return;
          if ((user.role === "school_admin" || user.role === "cashier") && (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)) return;
          latestStudents = disciplineStudentScope(user, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Student));
          onData(user.role === "discipline_director" ? { students: latestStudents, parents: disciplineParentScope(user, latestParents, latestStudents), disciplineSanctions: disciplineSanctionScope(user, latestSanctions, latestStudents) } : { students: latestStudents });
        },
        (error) => { if (active) onError?.("students", error); },
      ));
    }
    if (canReadParents) {
      unsubscribes.push(onSnapshot(
        query(collection(db, "parents"), where("schoolId", "==", schoolId)),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!active) return;
          if ((user.role === "school_admin" || user.role === "cashier") && (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)) return;
          latestParents = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ParentProfile);
          onData({ parents: disciplineParentScope(user, latestParents, latestStudents) });
        },
        (error) => { if (active) onError?.("parents", error); },
      ));
    }
    if (canReadSanctions) {
      unsubscribes.push(onSnapshot(
        query(collection(db, "disciplineSanctions"), ...annualConstraints),
        (snapshot) => {
          if (!active) return;
          latestSanctions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as DisciplineSanction);
          onData({ disciplineSanctions: disciplineSanctionScope(user, latestSanctions, latestStudents) });
        },
        (error) => { if (active) onError?.("disciplineSanctions", error); },
      ));
    }

    return () => { active = false; unsubscribes.forEach((unsubscribe) => unsubscribe()); };
  }, [includeStudents, onData, onError, schoolId, schoolYearId, user]);
}
