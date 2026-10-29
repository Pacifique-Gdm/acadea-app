import { collection, doc, onSnapshot, query, setDoc, where, type Firestore, type Unsubscribe } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppUser } from "../../types";
import { pedagogicalDocumentData, teachingProgressDocument, type PedagogicalDocument, type TeacherStudentObservation, type TeachingProgressEntry } from "./teacherLearning";

type LearningData={progress:TeachingProgressEntry[];observations:TeacherStudentObservation[];documents:PedagogicalDocument[]};
function databaseFor(user:AppUser,schoolId:string){if(!db||user.role!=="teacher"||user.schoolId!==schoolId||user.active===false||user.status==="inactive")throw new Error("Accès Enseignant non autorisé.");return db as unknown as Firestore;}
export function subscribeTeacherLearning(user: AppUser, schoolId: string, schoolYearId: string, teacherId: string, onData: (value: LearningData) => void, onError: (error: Error) => void): Unsubscribe {
  const database = databaseFor(user, schoolId);
  const state: LearningData = { progress: [], observations: [], documents: [] };
  const ready = new Set<keyof LearningData>();
  let failed = false;
  const scoped = (name: string) => query(collection(database, name), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId), where("teacherId", "==", teacherId));
  const sources = { progress: "teachingProgress", observations: "teacherStudentObservations", documents: "pedagogicalDocuments" };
  const unsubs = (Object.keys(sources) as Array<keyof LearningData>).map((key) => onSnapshot(scoped(sources[key]), (snapshot) => {
    Object.assign(state, { [key]: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) });
    ready.add(key);
    if (!failed && ready.size === 3) onData({ ...state });
  }, (error) => { failed = true; onError(error); }));
  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}
export async function saveTeachingProgress(user:AppUser,value:TeachingProgressEntry){const database=databaseFor(user,value.schoolId);await setDoc(doc(database,"teachingProgress",value.id),teachingProgressDocument(value));}
export async function savePedagogicalDocument(user:AppUser,value:PedagogicalDocument){const database=databaseFor(user,value.schoolId);await setDoc(doc(database,"pedagogicalDocuments",value.id),pedagogicalDocumentData(value));}
export async function archivePedagogicalDocument(user:AppUser,value:PedagogicalDocument){const database=databaseFor(user,value.schoolId);await setDoc(doc(database,"pedagogicalDocuments",value.id),{...value,archived:true,updatedAt:new Date().toISOString(),updatedBy:user.id});}
