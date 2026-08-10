import { collection, doc, onSnapshot, query, runTransaction, setDoc, where, writeBatch } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppUser } from "../../types";
import { pedagogicalAssignmentId, validateWeeklyPeriods } from "./studyAssignments";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyRoom, StudySubject, StudyTeacher, TeacherAvailability, Timetable, TimetableEntry } from "./studyTypes";
import { detectAvailabilityConflicts, validTimeRange, validatePeriod } from "./studySchedule";
import { validateAvailabilityRanges } from "./studySchedule";

function requireScope(user: AppUser, schoolId: string, schoolYearId: string) {
  if (!db || user.role !== "study_director" || user.schoolId !== schoolId || !schoolId || !schoolYearId) throw new Error("Périmètre pédagogique non autorisé.");
  return db as unknown as Firestore;
}

function scopedSubscription<T>(collectionName: string, schoolId: string, schoolYearId: string, onData: (items: T[]) => void, onError: (error: Error) => void) {
  if (!db) return () => undefined;
  const database = db as unknown as Firestore;
  return onSnapshot(query(collection(database, collectionName), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)), (snapshot) => {
    const uniqueItems = new Map(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
    onData([...uniqueItems.values()] as T[]);
  }, onError);
}

export function subscribeToStudyData(input: { user: AppUser; schoolId: string; schoolYearId: string; onTeachers: (items: StudyTeacher[]) => void; onSubjects: (items: StudySubject[]) => void; onClasses: (items: StudyClass[]) => void; onAssignments: (items: PedagogicalAssignment[]) => void; onAvailabilities:(items:TeacherAvailability[])=>void;onPeriods:(items:SchedulePeriod[])=>void;onTimetables:(items:Timetable[])=>void;onTimetableEntries:(items:TimetableEntry[])=>void;onRooms:(items:StudyRoom[])=>void; onError: (error: Error) => void }) {
  const database = requireScope(input.user, input.schoolId, input.schoolYearId);
  let teacherProfiles: StudyTeacher[] = [];
  let teacherUsers: AppUser[] = [];
  let profilesReady = false;
  let usersReady = false;
  const emitTeachers = () => {
    if (profilesReady && usersReady) input.onTeachers(mergeStudyTeachers(teacherProfiles, teacherUsers));
  };
  const teacherProfilesUnsubscribe = scopedSubscription<StudyTeacher>("teachers", input.schoolId, input.schoolYearId, (items) => {
    teacherProfiles = items;
    profilesReady = true;
    emitTeachers();
  }, input.onError);
  const teacherUsersUnsubscribe = onSnapshot(query(
    collection(database, "users"),
    where("schoolId", "==", input.schoolId),
    where("role", "==", "teacher"),
    where("status", "==", "active"),
  ), (snapshot) => {
    teacherUsers = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AppUser[];
    usersReady = true;
    emitTeachers();
  }, input.onError);
  return [
    teacherProfilesUnsubscribe,
    teacherUsersUnsubscribe,
    scopedSubscription("subjects", input.schoolId, input.schoolYearId, input.onSubjects, input.onError),
    scopedSubscription("classes", input.schoolId, input.schoolYearId, input.onClasses, input.onError),
    scopedSubscription("pedagogicalAssignments", input.schoolId, input.schoolYearId, input.onAssignments, input.onError),
    scopedSubscription("teacherAvailabilities",input.schoolId,input.schoolYearId,input.onAvailabilities,input.onError),
    scopedSubscription("schedulePeriods",input.schoolId,input.schoolYearId,input.onPeriods,input.onError),
    scopedSubscription("timetables",input.schoolId,input.schoolYearId,input.onTimetables,input.onError),
    scopedSubscription("timetableEntries",input.schoolId,input.schoolYearId,input.onTimetableEntries,input.onError),
    scopedSubscription("rooms",input.schoolId,input.schoolYearId,input.onRooms,input.onError),
  ];
}

export function mergeStudyTeachers(profiles: StudyTeacher[], users: AppUser[]) {
  const activeTeachers = new Map(users
    .filter((user) => user.role === "teacher" && user.status !== "inactive" && Boolean(user.schoolId))
    .map((user) => [user.id, user]));
  const linkedUsers = new Set<string>();

  return profiles.flatMap((profile) => {
    if (!profile.userId) return [profile];
    if (linkedUsers.has(profile.userId)) return [];
    const user = activeTeachers.get(profile.userId);
    if (!user || user.schoolId !== profile.schoolId) return [];
    linkedUsers.add(profile.userId);
    const fullName = user.name.trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    return [{
      ...profile,
      firstName: nameParts.slice(0, -1).join(" ") || fullName,
      lastName: nameParts.length > 1 ? nameParts.at(-1) ?? "" : "",
      fullName,
      email: user.email,
      phone: user.phone,
      status: "active" as const,
    }];
  });
}

export async function saveAvailability(input:{user:AppUser;item:TeacherAvailability;existing:TeacherAvailability[]}){const database=requireScope(input.user,input.item.schoolId,input.item.schoolYearId);if(input.item.status!=="rest"&&input.item.startTime&&!validTimeRange(input.item.startTime,input.item.endTime))throw new Error("Plage horaire invalide.");const next=[...input.existing.filter(x=>x.id!==input.item.id),input.item];if(detectAvailabilityConflicts(next))throw new Error("Cette disponibilité entre en conflit avec une contrainte existante.");await setDoc(doc(database,"teacherAvailabilities",input.item.id),input.item);}
export async function saveTeacherDayAvailability(input:{user:AppUser;schoolId:string;schoolYearId:string;teacherId:string;dayOfWeek:TeacherAvailability["dayOfWeek"];status:TeacherAvailability["status"];ranges:Array<{startTime:string;endTime:string}>;existing:TeacherAvailability[]}){const database=requireScope(input.user,input.schoolId,input.schoolYearId);const error=validateAvailabilityRanges(input.status,input.ranges);if(error)throw new Error(error);const teacherScoped=input.existing.filter(x=>x.teacherId===input.teacherId&&x.schoolId===input.schoolId&&x.schoolYearId===input.schoolYearId);const dayExisting=teacherScoped.filter(x=>x.dayOfWeek===input.dayOfWeek&&x.active);const byId=new Map(teacherScoped.map(item=>[item.id,item]));const now=new Date().toISOString();const ranges=input.status==="rest"||input.ranges.length===0?[undefined]:input.ranges;const created=ranges.map((range,index):TeacherAvailability=>{const id=`${input.schoolId}__${input.schoolYearId}__${input.teacherId}__${input.dayOfWeek}__${input.status}__${index}`;const previous=byId.get(id);return{id,schoolId:input.schoolId,schoolYearId:input.schoolYearId,teacherId:input.teacherId,dayOfWeek:input.dayOfWeek,status:input.status,...(range??{}),active:true,createdBy:previous?.createdBy??input.user.id,createdAt:previous?.createdAt??now,updatedAt:now};});if(detectAvailabilityConflicts([...teacherScoped.filter(x=>x.dayOfWeek!==input.dayOfWeek),...created]))throw new Error("Disponibilités contradictoires.");await runTransaction(database,async transaction=>{const refs=dayExisting.map(x=>doc(database,"teacherAvailabilities",x.id));await Promise.all(refs.map(ref=>transaction.get(ref)));refs.forEach(ref=>transaction.update(ref,{active:false,updatedAt:now}));created.forEach(item=>transaction.set(doc(database,"teacherAvailabilities",item.id),item));});}
export async function saveSchedulePeriod(input:{user:AppUser;item:SchedulePeriod;existing:SchedulePeriod[]}){const database=requireScope(input.user,input.item.schoolId,input.item.schoolYearId);const error=validatePeriod(input.item,input.existing,input.item.id);if(error)throw new Error(error);await setDoc(doc(database,"schedulePeriods",input.item.id),input.item);}
export async function setSchedulePeriodActive(user:AppUser,item:SchedulePeriod,active:boolean){const database=requireScope(user,item.schoolId,item.schoolYearId);await setDoc(doc(database,"schedulePeriods",item.id),{active,updatedAt:new Date().toISOString()},{merge:true});}

export async function saveGeneratedTimetable(input:{user:AppUser;schoolId:string;schoolYearId:string;version:number;entries:TimetableEntry[];existing:Timetable[];metadata:Timetable["generationMetadata"]}){const database=requireScope(input.user,input.schoolId,input.schoolYearId);if(input.entries.length>498)throw new Error("L’horaire dépasse la capacité d’un enregistrement atomique (498 créneaux).");const id=`${input.schoolId}__${input.schoolYearId}__v${input.version}`;if(input.existing.some(item=>item.id===id))throw new Error("Cette version d’horaire existe déjà.");const now=new Date().toISOString();const schedule:Timetable={id,schoolId:input.schoolId,schoolYearId:input.schoolYearId,version:input.version,status:"DRAFT",activeDraft:true,createdBy:input.user.id,createdAt:now,updatedAt:now,generationMetadata:input.metadata};const batch=writeBatch(database);input.existing.filter(item=>item.status==="DRAFT"&&item.activeDraft).forEach(item=>batch.update(doc(database,"timetables",item.id),{activeDraft:false,updatedAt:now}));batch.set(doc(database,"timetables",id),schedule);input.entries.forEach(entry=>{const saved={...entry,id:`${id}__${entry.id}`,scheduleId:id,createdAt:now,updatedAt:now};batch.set(doc(database,"timetableEntries",saved.id),saved)});await batch.commit();return schedule;}

export async function validateSavedTimetable(input:{user:AppUser;schedule:Timetable}){const database=requireScope(input.user,input.schedule.schoolId,input.schedule.schoolYearId);if(input.schedule.status!=="DRAFT")throw new Error("Seul un brouillon peut être validé.");const now=new Date().toISOString();await runTransaction(database,async transaction=>{const ref=doc(database,"timetables",input.schedule.id);const snapshot=await transaction.get(ref);if(!snapshot.exists()||snapshot.data()?.status!=="DRAFT")throw new Error("Le brouillon n’existe plus ou a déjà été validé.");transaction.update(ref,{status:"VALID",activeDraft:false,validatedAt:now,validatedBy:input.user.id,updatedAt:now});});}

export async function publishTimetable(input:{user:AppUser;schedule:Timetable;existing:Timetable[]}){const database=requireScope(input.user,input.schedule.schoolId,input.schedule.schoolYearId);if(input.schedule.status!=="VALID")throw new Error("Seul un horaire valide peut être publié.");const previous=input.existing.filter(item=>item.id!==input.schedule.id&&item.status==="PUBLISHED"&&item.activePublished);const now=new Date().toISOString();await runTransaction(database,async transaction=>{const currentRef=doc(database,"timetables",input.schedule.id);const previousRefs=previous.map(item=>doc(database,"timetables",item.id));const snapshots=await Promise.all([transaction.get(currentRef),...previousRefs.map(ref=>transaction.get(ref))]);if(!snapshots[0].exists()||snapshots[0].data()?.status!=="VALID")throw new Error("L’horaire n’est plus dans un état publiable.");previousRefs.forEach((ref,index)=>{if(snapshots[index+1].exists()&&snapshots[index+1].data()?.activePublished===true)transaction.update(ref,{activePublished:false,updatedAt:now})});transaction.update(currentRef,{status:"PUBLISHED",activePublished:true,activeDraft:false,publishedAt:now,publishedBy:input.user.id,updatedAt:now});});}

export async function saveStudyRoom(input:{user:AppUser;schoolId:string;schoolYearId:string;room?:StudyRoom;name:string}){const database=requireScope(input.user,input.schoolId,input.schoolYearId);const name=input.name.trim();if(!name)throw new Error("Le nom de la salle est obligatoire.");const now=new Date().toISOString();const id=input.room?.id??`${input.schoolId}__${input.schoolYearId}__${crypto.randomUUID()}`;const payload:StudyRoom={id,schoolId:input.schoolId,schoolYearId:input.schoolYearId,name,active:input.room?.active??true,createdBy:input.room?.createdBy??input.user.id,createdAt:input.room?.createdAt??now,updatedAt:now};await setDoc(doc(database,"rooms",id),payload);return payload;}
export async function setStudyRoomActive(user:AppUser,room:StudyRoom,active:boolean){const database=requireScope(user,room.schoolId,room.schoolYearId);await setDoc(doc(database,"rooms",room.id),{active,updatedAt:new Date().toISOString()},{merge:true});}

export async function createStudySubject(input: { user: AppUser; schoolId: string; schoolYearId: string; name: string }) {
  const database = requireScope(input.user, input.schoolId, input.schoolYearId);
  const name = input.name.trim();
  if (!name) throw new Error("Le nom de la matière est obligatoire.");
  const id = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  if (!id) throw new Error("Le nom de la matière est invalide.");
  const now = new Date().toISOString();
  await setDoc(doc(database, "subjects", `${input.schoolId}__${input.schoolYearId}__${id}`), { schoolId: input.schoolId, schoolYearId: input.schoolYearId, name, active: true, createdAt: now, updatedAt: now, createdBy: input.user.id }, { merge: false });
}

export async function savePedagogicalAssignment(input: { user: AppUser; schoolId: string; schoolYearId: string; teacherId: string; subjectId: string; classId: string; weeklyPeriods: number; blockSize?: 1 | 2; preferredRoomId?: string | null; active: boolean; current?: PedagogicalAssignment }) {
  const database = requireScope(input.user, input.schoolId, input.schoolYearId);
  if (!input.teacherId || !input.subjectId || !input.classId) throw new Error("L’enseignant, la matière et la classe sont obligatoires.");
  const periodError = validateWeeklyPeriods(input.weeklyPeriods);
  if (periodError) throw new Error(periodError);
  const targetId = pedagogicalAssignmentId(input);
  const now = new Date().toISOString();
  await runTransaction(database, async (transaction) => {
    const teacherRef = doc(database, "teachers", input.teacherId);
    const subjectRef = doc(database, "subjects", input.subjectId);
    const classRef = doc(database, "classes", input.classId);
    const roomRef = input.preferredRoomId ? doc(database, "rooms", input.preferredRoomId) : undefined;
    const targetRef = doc(database, "pedagogicalAssignments", targetId);
    // Do not read a target that may not exist: tenant-scoped read rules cannot
    // authorize a missing resource. The deterministic write remains validated
    // by the assignment create/update rules and the references read below.
    const [teacher, subject, schoolClass, room] = await Promise.all([transaction.get(teacherRef), transaction.get(subjectRef), transaction.get(classRef), roomRef ? transaction.get(roomRef) : Promise.resolve(undefined)]);
    const validReference = (snapshot: typeof teacher) => { const value = snapshot.data(); return snapshot.exists() && value?.schoolId === input.schoolId && value.schoolYearId === input.schoolYearId; };
    if (!validReference(teacher) || !validReference(subject) || !validReference(schoolClass)) throw new Error("Une référence pédagogique est inconnue ou hors périmètre.");
    if (room && (!room.exists() || room.data()?.schoolId !== input.schoolId || room.data()?.schoolYearId !== input.schoolYearId || room.data()?.active !== true)) throw new Error("La salle préférée est inconnue, inactive ou hors périmètre.");
    const payload = { id: targetId, schoolId: input.schoolId, schoolYearId: input.schoolYearId, teacherId: input.teacherId, subjectId: input.subjectId, classId: input.classId, weeklyPeriods: input.weeklyPeriods, blockSize: input.blockSize ?? input.current?.blockSize ?? 1, preferredRoomId: input.preferredRoomId ?? null, active: input.active, createdAt: input.current?.createdAt ?? now, updatedAt: now, createdBy: input.current?.createdBy ?? input.user.id, updatedBy: input.user.id };
    if (input.current && input.current.id !== targetId) transaction.update(doc(database, "pedagogicalAssignments", input.current.id), { active: false, updatedAt: now, updatedBy: input.user.id });
    transaction.set(targetRef, payload);
  });
}

export async function setPedagogicalAssignmentActive(user: AppUser, assignment: PedagogicalAssignment, active: boolean) {
  const database = requireScope(user, assignment.schoolId, assignment.schoolYearId);
  await setDoc(doc(database, "pedagogicalAssignments", assignment.id), { active, updatedAt: new Date().toISOString(), updatedBy: user.id }, { merge: true });
}

export async function setPedagogicalAssignmentBlockSize(user:AppUser,assignment:PedagogicalAssignment,blockSize:1|2){const database=requireScope(user,assignment.schoolId,assignment.schoolYearId);if(blockSize===2&&assignment.weeklyPeriods%2!==0)throw new Error("Le volume hebdomadaire doit être pair pour un cours double.");await setDoc(doc(database,"pedagogicalAssignments",assignment.id),{blockSize,updatedAt:new Date().toISOString(),updatedBy:user.id},{merge:true});}
