import { useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppUser, School } from "../types";
import { normalizeSchoolOptions } from "../utils/schoolOptions";

const allowedRoles = new Set<AppUser["role"]>([
  "school_admin",
  "secretary",
]);

export function canSubscribeToRealtimeSchoolSettings(user: AppUser | null, schoolId: string) {
  return Boolean(
    user &&
      user.status !== "inactive" &&
      allowedRoles.has(user.role) &&
      user.schoolId === schoolId &&
      schoolId,
  );
}

export function subscribeToRealtimeSchoolSettings(
  database: typeof db,
  user: AppUser,
  schoolId: string,
  onSchool: (school: School) => void,
  onError?: (error: Error) => void,
) {
  if (!database || !canSubscribeToRealtimeSchoolSettings(user, schoolId)) return undefined;
  return onSnapshot(
    doc(database, "schools", schoolId),
    (snapshot) => {
      if (!snapshot.exists()) return;
      const value = { id: snapshot.id, ...snapshot.data() } as School;
      onSchool({ ...value, schoolOptions: normalizeSchoolOptions(value.schoolOptions) });
    },
    (error) => onError?.(error),
  );
}

export function useRealtimeSchoolSettings({
  user,
  schoolId,
  onSchool,
  onError,
}: {
  user: AppUser | null;
  schoolId: string;
  onSchool: (school: School) => void;
  onError?: (error: Error) => void;
}) {
  useEffect(() => {
    if (!firebaseReady || !db || !user || !canSubscribeToRealtimeSchoolSettings(user, schoolId)) return undefined;
    return subscribeToRealtimeSchoolSettings(db, user, schoolId, onSchool, onError);
  }, [onError, onSchool, schoolId, user]);
}
