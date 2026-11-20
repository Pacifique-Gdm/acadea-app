import { useEffect, useMemo, useState } from "react";
import type { AppUser } from "../../types";
import { scopeTeacherPortalData, type TeacherPortalData } from "./teacherPortalData";
import { subscribeToTeacherPortalData } from "./teacherPortalService";
import { userFacingError } from "../../utils/userFacingError";
import { useLoadRetry } from "../../hooks/useLoadRetry";

const emptyData: TeacherPortalData = { assignments: [], subjects: [], classes: [], rooms: [], periods: [], entries: [], loading: true, error: "" };

export function applyTeacherSnapshot(current: TeacherPortalData, teacher: TeacherPortalData["teacher"]): TeacherPortalData {
  return { ...current, teacher, ...(teacher ? { error: "" } : {}) };
}

export function useTeacherPortalData(user: AppUser, schoolId: string, schoolYearId: string, refreshToken = 0) {
  const [data, setData] = useState<TeacherPortalData>(emptyData);
  const { token: loadRetryToken, retry } = useLoadRetry(Boolean(data.error));
  useEffect(() => {
    setData(emptyData);
    if (!schoolYearId) { setData({ ...emptyData, loading: false }); return; }
    try {
      return subscribeToTeacherPortalData({ user, schoolId, schoolYearId,
        onTeacher: (teacher) => setData((current) => applyTeacherSnapshot(current, teacher)),
        onTimetable: (activeTimetable) => setData((current) => ({ ...current, activeTimetable })),
        onAssignments: (assignments) => setData((current) => ({ ...current, assignments })),
        onSubjects: (subjects) => setData((current) => ({ ...current, subjects })),
        onClasses: (classes) => setData((current) => ({ ...current, classes })),
        onRooms: (rooms) => setData((current) => ({ ...current, rooms })),
        onPeriods: (periods) => setData((current) => ({ ...current, periods })),
        onEntries: (entries) => setData((current) => ({ ...current, entries })),
        onReady: () => setData((current) => ({ ...current, loading: false })),
        onError: (error) => setData((current) => ({ ...current, loading: false, error: userFacingError(error, "Chargement impossible. Veuillez réessayer.") })),
      });
    } catch (error) { setData((current) => ({ ...current, loading: false, error: userFacingError(error, "Chargement Enseignant impossible.") })); return undefined; }
  }, [refreshToken, schoolId, schoolYearId, user, loadRetryToken]);
  return useMemo(() => ({ ...scopeTeacherPortalData(user, data), retry }), [data, retry, user]);
}
