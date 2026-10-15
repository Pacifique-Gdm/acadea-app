import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import type { AppUser, SchoolYear } from "../../types";

export function useTeacherSchoolYears(user: AppUser, schoolId: string) {
  const [state, setState] = useState<{ key: string; years: SchoolYear[]; loading: boolean; error: string }>({ key: "", years: [], loading: true, error: "" });
  useEffect(() => {
    const key = `${user.id}:${schoolId}`;
    setState({ key, years: [], loading: true, error: "" });
    if (!db || user.role !== "teacher" || user.schoolId !== schoolId || user.active === false || user.status === "inactive") {
      setState({ key, years: [], loading: false, error: "Accès aux années scolaires non autorisé." });
      return;
    }
    return onSnapshot(query(collection(db, "schoolYears"), where("schoolId", "==", schoolId)),
      (snapshot) => setState({ key, years: snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as SchoolYear), loading: false, error: "" }),
      (error) => setState({ key, years: [], loading: false, error: error.message }));
  }, [schoolId, user.id, user.role, user.schoolId, user.active, user.status]);
  return state.key === `${user.id}:${schoolId}` ? state : { key: "", years: [], loading: true, error: "" };
}
