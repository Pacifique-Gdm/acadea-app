import{readFileSync}from"node:fs";import{assertFails,assertSucceeds,initializeTestEnvironment,type RulesTestEnvironment}from"@firebase/rules-unit-testing";import{collection,doc,getDoc,getDocs,query,setDoc,updateDoc,where}from"firebase/firestore";import{afterAll,beforeAll,beforeEach,describe,expect,it}from"vitest";
let env:RulesTestEnvironment;const school="school-a",year="year-a",now="2026-08-09T10:00:00.000Z";const db=(role="study_director",tenant=school)=>env.authenticatedContext(`${role}-user`,{role,schoolId:tenant}).firestore();const seed=async(path:string,data:Record<string,unknown>)=>env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),path),data));const availability={id:"availability-a",schoolId:school,schoolYearId:year,teacherId:"teacher-a",dayOfWeek:"monday",status:"rest",active:true,createdBy:"study_director-user",createdAt:now,updatedAt:now};const period={id:"period-a",schoolId:school,schoolYearId:year,label:"P1",startTime:"07:30",endTime:"08:20",order:1,type:"course",active:true,createdBy:"study_director-user",createdAt:now,updatedAt:now};
beforeAll(async()=>{env=await initializeTestEnvironment({projectId:"demo-study-schedule",firestore:{rules:readFileSync("firestore.rules","utf8")}})},30000);beforeEach(async()=>{await env.clearFirestore();await seed(`schools/${school}`,{status:"active"});await seed("schools/school-b",{status:"active"});await seed(`schoolYears/${year}`,{schoolId:school,status:"active"});await seed("schoolYears/year-b",{schoolId:"school-b",status:"active"});await seed("teachers/teacher-a",{schoolId:school,schoolYearId:year,status:"active"})});afterAll(async()=>env?.cleanup(),30000);
beforeEach(async()=>{for(const role of ["study_director","school_admin","secretary","discipline_director","cashier"]){const id=`${role}-user`;await seed(`users/${id}`,{id,role,schoolId:school,status:"active"})}});
describe("Phase 3 Firestore",()=>{it("autorise lecture et création historique, mais bloque modification directe",async()=>{await assertSucceeds(setDoc(doc(db(),"teacherAvailabilities","availability-a"),availability));await assertSucceeds(updateDoc(doc(db(),"teacherAvailabilities","availability-a"),{active:false,updatedAt:"later"}));await assertSucceeds(getDocs(query(collection(db(),"teacherAvailabilities"),where("schoolId","==",school),where("schoolYearId","==",year))));await assertSucceeds(setDoc(doc(db(),"schedulePeriods","period-a"),period));await assertFails(updateDoc(doc(db(),"schedulePeriods","period-a"),{active:false,updatedAt:"later"}))});it("refuse autre école, année et rôle",async()=>{await assertFails(setDoc(doc(db("cashier"),"teacherAvailabilities","x"),{...availability,id:"x",createdBy:"cashier-user"}));await assertFails(setDoc(doc(db("study_director","school-b"),"schedulePeriods","x"),{...period,id:"x",createdBy:"study_director-user"}));await assertFails(setDoc(doc(db(),"schedulePeriods","x"),{...period,id:"x",schoolYearId:"year-b"}))});it("interdit le détournement école/année et enseignant",async()=>{await assertSucceeds(setDoc(doc(db(),"teacherAvailabilities","availability-a"),availability));await assertFails(updateDoc(doc(db(),"teacherAvailabilities","availability-a"),{schoolId:"school-b"}));await assertFails(updateDoc(doc(db(),"teacherAvailabilities","availability-a"),{schoolYearId:"year-b"}));await assertFails(setDoc(doc(db(),"teacherAvailabilities","x"),{...availability,id:"x",teacherId:"unknown"}))});it("matérialise une classe legacy sans autoriser sa mutation directe",async()=>{const id=`${school}__${year}__3eme-humanite`;await assertSucceeds(setDoc(doc(db(),"classes",id),{id,schoolId:school,schoolYearId:year,name:"3ème Humanité",active:true,vacation:"morning",saturdayEnabled:false,saturdayVacation:null,createdBy:"study_director-user",createdAt:now,updatedAt:now}));await assertFails(updateDoc(doc(db(),"classes",id),{vacation:"afternoon",updatedAt:"later"}));await assertFails(updateDoc(doc(db(),"classes",id),{name:"Classe détournée",updatedAt:"later"}));const foreign=`${school}__${year}__foreign`;await assertFails(setDoc(doc(db(),"classes",foreign),{id:foreign,schoolId:"school-b",schoolYearId:"year-b",name:"Autre",active:true,vacation:"morning",createdBy:"study_director-user",createdAt:now,updatedAt:now}))});it("maintient les finances interdites",async()=>{await assertFails(getDoc(doc(db(),"payments","payment-a")));await assertFails(setDoc(doc(db(),"expenses","expense-a"),{schoolId:school,schoolYearId:year,amount:1}))})});

describe("persistance des périodes",()=>{
  it("relit la modification et la désactivation sans altérer une autre période",async()=>{
    const session=db();
    await assertSucceeds(setDoc(doc(session,"schedulePeriods","period-a"),period));
    await assertSucceeds(setDoc(doc(session,"schedulePeriods","period-b"),{...period,id:"period-b",label:"P2",startTime:"08:20",endTime:"09:10",order:2}));
    await assertFails(updateDoc(doc(session,"schedulePeriods","period-a"),{label:"Cours corrigé",startTime:"07:40",updatedAt:"later"}));
    expect((await getDoc(doc(session,"schedulePeriods","period-a"))).data()).toMatchObject({label:"P1",startTime:"07:30",active:true});
    await assertFails(updateDoc(doc(session,"schedulePeriods","period-a"),{active:false,updatedAt:"later-2"}));
    expect((await getDoc(doc(session,"schedulePeriods","period-a"))).data()).toMatchObject({label:"P1",active:true});
    expect((await getDoc(doc(session,"schedulePeriods","period-b"))).data()).toMatchObject({label:"P2",active:true});
  });
  it("refuse l'édition hors établissement et aux rôles non autorisés",async()=>{
    await assertSucceeds(setDoc(doc(db(),"schedulePeriods","period-a"),period));
    await assertFails(updateDoc(doc(db("cashier"),"schedulePeriods","period-a"),{label:"Interdit"}));
    await assertFails(updateDoc(doc(db("study_director","school-b"),"schedulePeriods","period-a"),{label:"Interdit"}));
  });
});

describe("vacations journalières et portée ciblée", () => {
  it("empêche l'Administrateur de contourner l'API sur les vacations historiques d'un horaire validé", async () => {
    const id = `${school}__${year}__classe-historique`;
    await seed(`classes/${id}`, { id, schoolId: school, schoolYearId: year, name: "Classe historique", active: true, vacation: "morning", saturdayEnabled: false, saturdayVacation: null, createdBy: "study_director-user", createdAt: now, updatedAt: now });
    await seed("timetables/valid", { id: "valid", schoolId: school, schoolYearId: year, status: "VALID" });
    await seed("timetableEntries/entry", { id: "entry", scheduleId: "valid", schoolId: school, schoolYearId: year, classId: id, periodId: "period-a", active: true });
    const classRef = doc(db("school_admin"), "classes", id);
    await assertFails(updateDoc(classRef, { vacation: "afternoon", updatedAt: "later" }));
    await assertFails(updateDoc(classRef, { saturdayEnabled: true, saturdayVacation: "afternoon", updatedAt: "later" }));
    await assertFails(updateDoc(classRef, { dayVacations: { monday: "afternoon" }, updatedAt: "later" }));
    await assertSucceeds(updateDoc(classRef, { name: "Classe historique renommée", updatedAt: "later" }));
    expect((await getDoc(classRef)).data()).toMatchObject({ vacation: "morning", saturdayEnabled: false, saturdayVacation: null, name: "Classe historique renommée" });
  });

  it("permet au Directeur de configurer sa classe sans modifier son identité", async () => {
    const id = `${school}__${year}__classe-test`;
    await assertSucceeds(setDoc(doc(db(), "classes", id), { id, schoolId: school, schoolYearId: year, name: "Classe test", active: true, createdBy: "study_director-user", createdAt: now, updatedAt: now, vacation: "morning", saturdayEnabled: false, saturdayVacation: null }));
    await assertFails(updateDoc(doc(db(), "classes", id), { dayVacations: { monday: "afternoon", tuesday: "none" }, updatedAt: "later" }));
    await assertFails(updateDoc(doc(db(), "classes", id), { dayVacations: { monday: "invalid" } }));
    await assertFails(updateDoc(doc(db("school_admin"), "classes", id), { dayVacations: { monday: "full" } }));
    await assertFails(updateDoc(doc(db("study_director", "school-b"), "classes", id), { dayVacations: { monday: "full" } }));
    expect((await getDoc(doc(db(), "classes", id))).data()?.dayVacations).toBeUndefined();
  });

  it("borne les périodes collectives à l'école, l'année et au Directeur", async () => {
    const targeted = { ...period, targetPairs: [`${school}__${year}__classe-test|monday`, `${school}__${year}__classe-test|tuesday`] };
    await assertFails(setDoc(doc(db(), "schedulePeriods", "period-a"), targeted));
    await assertFails(setDoc(doc(db("cashier"), "schedulePeriods", "other"), { ...targeted, id: "other", createdBy: "cashier-user" }));
    await assertFails(setDoc(doc(db(), "schedulePeriods", "empty"), { ...targeted, id: "empty", targetPairs: [] }));
    await seed("schedulePeriods/period-a", targeted);
    await assertFails(updateDoc(doc(db(), "schedulePeriods", "period-a"), { label: "Contournement" }));
    await assertFails(updateDoc(doc(db("study_director", "school-b"), "schedulePeriods", "period-a"), { label: "Hors école" }));
  });
});
