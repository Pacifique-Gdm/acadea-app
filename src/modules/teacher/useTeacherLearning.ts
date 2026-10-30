import { useEffect, useState } from "react";
import type { AppUser } from "../../types";
import type { PedagogicalDocument, TeacherStudentObservation, TeachingProgressEntry } from "./teacherLearning";
import { subscribeTeacherLearning } from "./teacherLearningService";

export function useTeacherLearning(user: AppUser, schoolId: string, schoolYearId: string, teacherId?: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ progress: TeachingProgressEntry[]; observations: TeacherStudentObservation[]; documents: PedagogicalDocument[]; loading: boolean; error: string }>({ progress: [], observations: [], documents: [], loading: true, error: "" });
  useEffect(() => {
    let active = true;
    const empty = { progress: [], observations: [], documents: [] };
    if (!teacherId) { setState({ ...empty, loading: false, error: "" }); return; }
    setState({ ...empty, loading: true, error: "" });
    try {
      const unsubscribe = subscribeTeacherLearning(user, schoolId, schoolYearId, teacherId,
        (value) => { if (active) setState({ ...value, loading: false, error: "" }); },
        (error) => { if (active) setState({ ...empty, loading: false, error: error.message }); });
      return () => { active = false; unsubscribe(); };
    } catch (cause) { setState({ ...empty, loading: false, error: cause instanceof Error ? cause.message : "Chargement impossible." }); }
  }, [schoolId, schoolYearId, teacherId, user, revision]);
  return { ...state, retry: () => setRevision((value) => value + 1) };
}
