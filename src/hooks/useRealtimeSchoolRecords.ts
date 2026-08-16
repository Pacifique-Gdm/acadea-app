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
  onData,
  onError,
}: {
  user: AppUser | null;
  schoolId: string;
  schoolYearId: string;
  onData: (data: RealtimeSchoolRecords) => void;
  onError?: (source: keyof RealtimeSchoolRecords, error: Error) => void;
}) {
  useEffect(() => {
    if (!db || !user || !schoolId || !schoolYearId) return;

    const unsubscribes: Array<() => void> = [];
    let latestStudents: Student[] = [];
    let latestSanctions: DisciplineSanction[] = [];
    let latestParents: ParentProfile[] = [];
    const annualConstraints = [where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)];
    const assignedSections = userSectionIds(user);
    const studentConstraints = user.role === "secretary"
      ? [where("schoolId", "==", schoolId)]
      : user.role === "discipline_director" && assignedSections.length
        ? [...annualConstraints, where("section", "in", assignedSections)]
        : annualConstraints;
    const canReadStudents = ["school_admin", "cashier", "discipline_director", "secretary"].includes(user.role);
    const canReadParents = ["school_admin", "discipline_director", "secretary"].includes(user.role);
    const canReadSanctions = ["school_admin", "discipline_director"].includes(user.role);

    if (canReadStudents) {
      unsubscribes.push(onSnapshot(
        query(collection(db, "students"), ...studentConstraints),
        (snapshot) => {
          latestStudents = disciplineStudentScope(user, snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Student));
          onData({ students: latestStudents, parents: disciplineParentScope(user, latestParents, latestStudents), disciplineSanctions: disciplineSanctionScope(user, latestSanctions, latestStudents) });
        },
        (error) => onError?.("students", error),
      ));
    }
    if (canReadParents) {
      unsubscribes.push(onSnapshot(
        query(collection(db, "parents"), where("schoolId", "==", schoolId)),
        (snapshot) => {
          latestParents = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ParentProfile);
          onData({ parents: disciplineParentScope(user, latestParents, latestStudents) });
        },
        (error) => onError?.("parents", error),
      ));
    }
    if (canReadSanctions) {
      unsubscribes.push(onSnapshot(
        query(collection(db, "disciplineSanctions"), ...annualConstraints),
        (snapshot) => {
          latestSanctions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as DisciplineSanction);
          onData({ disciplineSanctions: disciplineSanctionScope(user, latestSanctions, latestStudents) });
        },
        (error) => onError?.("disciplineSanctions", error),
      ));
    }

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [onData, onError, schoolId, schoolYearId, user]);
}
