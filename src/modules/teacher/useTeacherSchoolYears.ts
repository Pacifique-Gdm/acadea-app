import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import type { AppUser, SchoolYear } from "../../types";
import { userFacingError } from "../../utils/userFacingError";
import { useLoadRetry } from "../../hooks/useLoadRetry";

export function useTeacherSchoolYears(user: AppUser, schoolId: string) {
  const [state, setState] = useState<{ key: string; years: SchoolYear[]; loading: boolean; error: string }>({ key: "", years: [], loading: true, error: "" });
  const { token: loadRetryToken, retry } = useLoadRetry(Boolean(state.error));
  useEffect(() => {
    const key = `${user.id}:${schoolId}`;
    setState({ key, years: [], loading: true, error: "" });
    if (!db || user.role !== "teacher" || user.schoolId !== schoolId || user.active === false || user.status === "inactive") {
      setState({ key, years: [], loading: false, error: "Accès aux années scolaires non autorisé." });
      return;
    }
    return onSnapshot(query(collection(db, "schoolYears"), where("schoolId", "==", schoolId)),
      (snapshot) => setState({ key, years: snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as SchoolYear), loading: false, error: "" }),
      (error) => setState({ key, years: [], loading: false, error: userFacingError(error, "Chargement impossible. Veuillez réessayer.") }));
  }, [schoolId, user.id, user.role, user.schoolId, user.active, user.status, loadRetryToken]);
  return state.key === `${user.id}:${schoolId}` ? { ...state, retry } : { key: "", years: [], loading: true, error: "", retry };
}
