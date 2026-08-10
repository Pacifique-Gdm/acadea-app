import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { AppUser } from "../types";

export function subscribeToSchoolTeacherAccounts(input: {
  user: AppUser;
  schoolId: string;
  onData: (users: AppUser[]) => void;
  onError: (error: Error) => void;
}) {
  if (!db || input.user.role !== "school_admin" || input.user.schoolId !== input.schoolId || input.user.status === "inactive") return undefined;
  return onSnapshot(
    query(collection(db as unknown as Firestore, "users"), where("schoolId", "==", input.schoolId), where("role", "==", "teacher")),
    (snapshot) => input.onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AppUser[]),
    input.onError,
  );
}
