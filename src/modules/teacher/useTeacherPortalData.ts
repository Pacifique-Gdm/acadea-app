import { useEffect, useMemo, useState } from "react";
import type { AppUser } from "../../types";
import { scopeTeacherPortalData, type TeacherPortalData } from "./teacherPortalData";
import { subscribeToTeacherPortalData } from "./teacherPortalService";

const emptyData: TeacherPortalData = { assignments: [], subjects: [], classes: [], rooms: [], periods: [], entries: [], loading: true, error: "" };

export function useTeacherPortalData(user: AppUser, schoolId: string, schoolYearId: string, refreshToken = 0) {
  const [data, setData] = useState<TeacherPortalData>(emptyData);
  useEffect(() => {
    setData(emptyData);
    try {
      return subscribeToTeacherPortalData({ user, schoolId, schoolYearId,
        onTeacher: (teacher) => setData((current) => ({ ...current, teacher })),
        onTimetable: (activeTimetable) => setData((current) => ({ ...current, activeTimetable })),
        onAssignments: (assignments) => setData((current) => ({ ...current, assignments })),
        onSubjects: (subjects) => setData((current) => ({ ...current, subjects })),
        onClasses: (classes) => setData((current) => ({ ...current, classes })),
        onRooms: (rooms) => setData((current) => ({ ...current, rooms })),
        onPeriods: (periods) => setData((current) => ({ ...current, periods })),
        onEntries: (entries) => setData((current) => ({ ...current, entries })),
        onReady: () => setData((current) => ({ ...current, loading: false })),
        onError: (error) => setData((current) => ({ ...current, loading: false, error: error.message })),
      });
    } catch (error) { setData((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Chargement Enseignant impossible." })); return undefined; }
  }, [refreshToken, schoolId, schoolYearId, user]);
  return useMemo(() => scopeTeacherPortalData(user, data), [data, user]);
}
