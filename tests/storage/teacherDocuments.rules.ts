import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
let env:RulesTestEnvironment;const school="school-a",year="year-a",uid="teacher-user-a",teacher="teacher-a",assignment="assignment-a",documentId="document-a",file="123e4567-e89b-12d3-a456-426614174000.pdf";
const context=(id=uid,role="teacher",tenant=school)=>env.authenticatedContext(id,{role,schoolId:tenant});
const put=(id=uid,role="teacher",tenant=school,type="application/pdf",size=1024,assignmentId=assignment)=>context(id,role,tenant).storage().ref(`teacher-documents/${school}/${year}/${uid}/${teacher}/${assignmentId}/${documentId}/${file}`).put(new Uint8Array(size),{contentType:type,customMetadata:{schoolId:school,schoolYearId:year,ownerId:uid,teacherId:teacher,assignmentId,documentId,originalName:"fiche.pdf"}});
describe("documents pédagogiques Storage",()=>{beforeAll(async()=>{env=await initializeTestEnvironment({projectId:"acadea-staging",firestore:{rules:readFileSync("firestore.rules","utf8")},storage:{rules:readFileSync("storage.rules","utf8")}})},30000);beforeEach(async()=>{await env.clearFirestore();await env.clearStorage();await env.withSecurityRulesDisabled(async admin=>{await setDoc(doc(admin.firestore(),`schools/${school}`),{status:"active"});await setDoc(doc(admin.firestore(),`teachers/${teacher}`),{userId:uid,schoolId:school,schoolYearId:year,status:"active"});await setDoc(doc(admin.firestore(),`pedagogicalAssignments/${assignment}`),{teacherId:teacher,schoolId:school,schoolYearId:year,active:true})})});afterAll(()=>env.cleanup());
it("autorise le teacher propriétaire actif",async()=>assertSucceeds(put()));
it("refuse autre UID, rôle, école et MIME",async()=>{await assertFails(put("other"));await assertFails(put(uid,"secretary"));await assertFails(put(uid,"teacher","school-b"));await assertFails(put(uid,"teacher",school,"text/html"));await assertFails(put(uid,"teacher",school,"application/pdf",1024,"assignment-other"));});
it("refuse vide et supérieur à 10 Mo",async()=>{await assertFails(put(uid,"teacher",school,"application/pdf",0));await assertFails(put(uid,"teacher",school,"application/pdf",10*1024*1024+1));});});

