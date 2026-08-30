import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, Coordination, School, SchoolYear } from "../types";

export function isSchoolClosedByCoordination(school: School | undefined, coordination: Coordination | null) {
  return Boolean(school?.activeCoordinationId && coordination?.id === school.activeCoordinationId
    && coordination.status === "active" && coordination.yearGovernance?.status === "closed"
    && coordination.yearGovernance.years.some((year) => year.schoolId === school.id));
}

export function useCoordinatedSchoolYears(user: AppUser | null, school: School | undefined, onYears: (years: SchoolYear[]) => void) {
  const schoolId = user?.role === "school_admin" && user.schoolId === school?.id ? school?.id ?? "" : "";
  const coordinationId = schoolId ? school?.activeCoordinationId ?? "" : "";
  const [state, setState] = useState<{ key: string; coordination: Coordination | null; error: string }>({ key: "", coordination: null, error: "" });
  const key = coordinationId ? `${schoolId}/${coordinationId}` : "";
  useEffect(() => {
    if (!key || !firebaseReady || !db) return;
    let cancelled = false;
    const fail = () => { if (!cancelled) setState({ key, coordination: null, error: "Impossible de vérifier la gouvernance des années scolaires. Veuillez réessayer." }); };
    const stopCoordination = onSnapshot(doc(db, "coordinations", coordinationId), (snapshot) => {
      if (!cancelled) setState({ key, coordination: snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as Coordination : null, error: "" });
    }, fail);
    const stopYears = onSnapshot(query(collection(db, "schoolYears"), where("schoolId", "==", schoolId)), (snapshot) => {
      if (!cancelled) onYears(snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as SchoolYear));
    }, fail);
    return () => { cancelled = true; stopCoordination(); stopYears(); };
  }, [coordinationId, key, onYears, schoolId]);
  return {
    closed: Boolean(key && state.key === key && isSchoolClosedByCoordination(school, state.coordination)),
    loading: Boolean(key && state.key !== key),
    error: key && state.key === key ? state.error : "",
  };
}
