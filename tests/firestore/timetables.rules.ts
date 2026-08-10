import{readFileSync}from"node:fs";import{assertFails,assertSucceeds,initializeTestEnvironment,type RulesTestEnvironment}from"@firebase/rules-unit-testing";import{collection,doc,getDoc,getDocs,query,setDoc,updateDoc,deleteDoc,where,writeBatch}from"@firebase/firestore";import{afterAll,beforeAll,beforeEach,describe,expect,it}from"vitest";
import type{AppUser}from"../../src/types";import{persistGeneratedTimetable}from"../../src/modules/studies/timetablePersistence";
let env:RulesTestEnvironment;const school="school-a",year="year-a",now="2026-08-09T10:00:00.000Z";const db=(role="study_director",tenant=school)=>env.authenticatedContext(`${role}-user`,{role,schoolId:tenant}).firestore();const seed=async(path:string,data:Record<string,unknown>)=>env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),path),data));const schedule=(overrides:Record<string,unknown>={})=>({id:"schedule-a",schoolId:school,schoolYearId:year,version:1,status:"DRAFT",activeDraft:true,createdBy:"study_director-user",createdAt:now,updatedAt:now,generationMetadata:{algorithm:"deterministic-backtracking"},...overrides});const entry={id:"entry-a",scheduleId:"schedule-a",schoolId:school,schoolYearId:year,classId:"class-a",teacherId:"teacher-a",subjectId:"subject-a",assignmentId:"assignment-a",dayOfWeek:"monday",periodId:"period-a",roomId:null,createdAt:now,updatedAt:now};
beforeAll(async()=>{env=await initializeTestEnvironment({projectId:"demo-timetables",firestore:{rules:readFileSync("firestore.rules","utf8")}})},30000);beforeEach(async()=>{await env.clearFirestore();await seed(`schools/${school}`,{status:"active"});await seed("schools/school-b",{status:"active"});await seed(`schoolYears/${year}`,{schoolId:school,status:"active"});await seed("schoolYears/year-b",{schoolId:"school-b",status:"active"});await seed("teachers/teacher-a",{schoolId:school,schoolYearId:year});await seed("subjects/subject-a",{schoolId:school,schoolYearId:year});await seed("classes/class-a",{schoolId:school,schoolYearId:year});await seed("pedagogicalAssignments/assignment-a",{schoolId:school,schoolYearId:year,teacherId:"teacher-a",subjectId:"subject-a",classId:"class-a"});await seed("schedulePeriods/period-a",{schoolId:school,schoolYearId:year,type:"course"});await seed("students/student-a",{schoolId:school,schoolYearId:year,classId:"class-a",className:"Classe A"})});afterAll(async()=>env?.cleanup(),30000);
describe("Phase 4 Firestore",()=>{it("crée atomiquement brouillon et entry dans sa portée",async()=>{const database=db(),batch=writeBatch(database);batch.set(doc(database,"timetables","schedule-a"),schedule());batch.set(doc(database,"timetableEntries","entry-a"),entry);await assertSucceeds(batch.commit());await assertSucceeds(getDoc(doc(database,"timetables","schedule-a")));await assertSucceeds(getDoc(doc(database,"timetableEntries","entry-a")))});it("refuse autre école et autre année",async()=>{await assertFails(setDoc(doc(db("study_director","school-b"),"timetables","schedule-a"),schedule()));await assertFails(setDoc(doc(db(),"timetables","schedule-a"),schedule({schoolYearId:"year-b"})))});it("refuse les autres rôles",async()=>assertFails(setDoc(doc(db("cashier"),"timetables","schedule-a"),schedule({createdBy:"cashier-user"}))));it("refuse changement école et année",async()=>{await seed("timetables/schedule-a",schedule());await assertFails(updateDoc(doc(db(),"timetables","schedule-a"),{schoolId:"school-b"}));await assertFails(updateDoc(doc(db(),"timetables","schedule-a"),{schoolYearId:"year-b"}))});it("autorise validation DRAFT vers VALID",async()=>{await seed("timetables/schedule-a",schedule());await assertSucceeds(updateDoc(doc(db(),"timetables","schedule-a"),{status:"VALID",activeDraft:false,validatedBy:"study_director-user",validatedAt:"later",updatedAt:"later"}))});it("refuse publication",async()=>{await seed("timetables/schedule-a",schedule());await assertFails(updateDoc(doc(db(),"timetables","schedule-a"),{status:"PUBLISHED",updatedAt:"later"}))});it("refuse suppression physique",async()=>{await seed("timetables/schedule-a",schedule({status:"VALID",activeDraft:false}));await assertFails(deleteDoc(doc(db(),"timetables","schedule-a")))});it("maintient les finances interdites",async()=>assertFails(getDoc(doc(db(),"payments","payment-a"))))});

describe("persistance complète d’un horaire",()=>{
  it("generate → persist → destroy local state → reload from Firestore → validate → publish → reload",async()=>{
    const firstSession=db();
    const user:AppUser={id:"study_director-user",name:"Direction",email:"direction@test.invalid",role:"study_director",schoolId:school};
    const persisted=await assertSucceeds(persistGeneratedTimetable(firstSession,{user,schoolId:school,schoolYearId:year,version:1,entries:[entry],existing:[],metadata:{algorithm:"deterministic-backtracking",exploredBranches:1,durationMs:1,maxSameAssignmentPeriodsPerDay:2}}));
    const entryId=`${persisted.id}__entry-a`;

    const secondSession=db();
    const reloadedSchedule=await assertSucceeds(getDoc(doc(secondSession,"timetables",persisted.id)));
    const reloadedEntries=await assertSucceeds(getDocs(query(collection(secondSession,"timetableEntries"),where("schoolId","==",school),where("schoolYearId","==",year),where("scheduleId","==",persisted.id))));
    expect(reloadedSchedule.data()).toMatchObject({id:persisted.id,schoolId:school,schoolYearId:year,status:"DRAFT"});
    expect(reloadedEntries.docs.map(item=>item.data())).toEqual([expect.objectContaining({classId:"class-a",teacherId:"teacher-a",dayOfWeek:"monday",periodId:"period-a"})]);

    await assertSucceeds(updateDoc(doc(secondSession,"timetables",persisted.id),{status:"VALID",activeDraft:false,validatedBy:"study_director-user",validatedAt:"validated",updatedAt:"validated"}));
    await assertSucceeds(updateDoc(doc(secondSession,"timetables",persisted.id),{status:"PUBLISHED",activePublished:true,publishedBy:"study_director-user",publishedAt:"published",updatedAt:"published"}));

    const thirdSession=db();
    const published=await assertSucceeds(getDoc(doc(thirdSession,"timetables",persisted.id)));
    expect(published.data()).toMatchObject({status:"PUBLISHED",activeDraft:false,activePublished:true});
    expect((await assertSucceeds(getDoc(doc(thirdSession,"timetableEntries",entryId)))).exists()).toBe(true);
    await assertFails(getDoc(doc(db("study_director","school-b"),"timetables",persisted.id)));
  });
});

describe("lecture des classes réellement utilisées",()=>{
  it("autorise le Directeur des études à lire les élèves de son école",async()=>assertSucceeds(getDoc(doc(db(),"students","student-a"))));
  it("refuse au Directeur des études d’une autre école",async()=>assertFails(getDoc(doc(db("study_director","school-b"),"students","student-a"))));
});
