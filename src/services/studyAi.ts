import { getFunctions, httpsCallable } from "firebase/functions";
import { app, auth } from "../firebase";
import type { AppUser } from "../types";
import type { StudyAiInterpretation } from "../modules/studies/studyAssistant";
export async function requestStudyAi(user:AppUser,input:{schoolId:string;schoolYearId:string;prompt:string;context:Record<string,unknown>}){if(!app||!auth?.currentUser||auth.currentUser.uid!==user.id||user.role!=="study_director"||user.schoolId!==input.schoolId||user.status==="inactive")throw new Error("Action IA non autorisée.");const callable=httpsCallable<typeof input&{idempotencyKey:string},StudyAiInterpretation>(getFunctions(app,"europe-west1"),"studyAiAssistant",{timeout:60000});const result=await callable({...input,idempotencyKey:crypto.randomUUID()});return result.data;}
