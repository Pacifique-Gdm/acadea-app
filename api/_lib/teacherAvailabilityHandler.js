import { initAdmin } from "./firebaseAdmin.js";
import { requireActiveApiUser, verifyActorIdToken } from "./activeUser.js";
import { AvailabilityRequestApiError, createAvailabilityRequest, listAvailabilityRequests, reviewAvailabilityRequest } from "./teacherAvailabilityRequests.js";
import { PublishedTimetableReadError, readPublishedTimetable } from "./publishedTimetableRead.js";
import { readDisciplineClasses } from "./disciplineClassesRead.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./rateLimit.js";

// Regroupement lot 1 (limite de 12 fonctions Vercel) : ancien fichier api/manage-teacher-availability-request.js.
// L’adresse /api/manage-teacher-availability-request est gardée : vercel.json la redirige vers
// /api/manage-teacher-grading?route=teacher-availability, qui appelle ce code sans rien changer aux réponses.
export const TEACHER_AVAILABILITY_ROUTE="teacher-availability";
const send=(res,status,body)=>{res.statusCode=status;res.setHeader("Content-Type","application/json");res.end(JSON.stringify(body))};
function parseBody(body){if(typeof body==="object"&&body)return body;try{return JSON.parse(body||"{}")}catch{throw new AvailabilityRequestApiError(400,"invalid-argument","Corps JSON invalide.")}}
export default async function handler(req,res){if(req.method==="GET"&&req.query?.view==="availability-requests")return availabilityRequests(req,res);if(req.method==="GET")return publishedTimetable(req,res);if(req.method!=="POST")return send(res,405,{error:"Méthode non autorisée.",code:"invalid-argument"});try{const authorization=req.headers.authorization??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";if(!token)throw new AvailabilityRequestApiError(401,"unauthenticated","Authentification requise.");const{auth,db}=initAdmin();const caller=await verifyActorIdToken(auth,token);const body=parseBody(req.body);await requireActiveApiUser(db,caller);const request=body.action==="CREATE"?await createAvailabilityRequest({db,caller,request:body.request}):await reviewAvailabilityRequest({db,caller,requestId:body.requestId,action:body.action,reviewComment:body.reviewComment});return send(res,200,{request})}catch(error){if(error instanceof AvailabilityRequestApiError)return send(res,error.status,{error:error.message,code:error.code});if(error?.statusCode===400&&!error?.code)return send(res,400,{error:"Corps JSON invalide.",code:"invalid-argument"});if(error?.statusCode===401||error?.statusCode===403)return send(res,error.statusCode,{error:error.message,code:error.code});console.error("[Acadéa indisponibilités] Traitement échoué.",{code:typeof error?.code==="string"?error.code:"internal"});return send(res,500,{error:"Traitement de la demande impossible.",code:"internal"})}}

async function publishedTimetable(req,res){
  res.setHeader("Cache-Control","private, no-store");
  try {
    const query=req.query??{};
    if(!["published-timetable","attendance-classes"].includes(query.view)||Object.keys(query).some(key=>!["view","schoolYearId"].includes(key)))throw new PublishedTimetableReadError(400,"invalid-argument","Paramètres de consultation invalides.");
    const authorization=req.headers.authorization??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
    if(!token)throw new PublishedTimetableReadError(401,"unauthenticated","Authentification requise.");
    const{auth,db}=initAdmin(),caller=await verifyActorIdToken(auth,token);
    await requireActiveApiUser(db,caller);
    if(!["school_admin","secretary","discipline_director","study_director","teacher"].includes(caller.role)||!caller.schoolId)throw new PublishedTimetableReadError(403,"permission-denied","Consultation de l’horaire non autorisée.");
    await enforceApiRateLimit({db,actorId:caller.uid,schoolId:caller.schoolId,action:"school.published-timetable.read",...API_RATE_LIMITS.PUBLISHED_TIMETABLE});
    if(query.view==="attendance-classes")return send(res,200,{classes:await readDisciplineClasses({db,caller,schoolYearId:query.schoolYearId})});
    const timetable=await readPublishedTimetable({db,caller,schoolYearId:query.schoolYearId});
    return send(res,200,{timetable});
  } catch(error) {
    if(sendRateLimitError(res,error))return;
    if(error instanceof PublishedTimetableReadError)return send(res,error.status,{error:error.message,code:error.code});
    if(error?.statusCode===401||error?.statusCode===403)return send(res,error.statusCode,{error:error.message,code:error.code});
    console.error("[Acadéa horaire publié] Lecture échouée.",{code:typeof error?.code==="string"?error.code:"internal"});
    return send(res,500,{error:"Horaire publié indisponible.",code:"internal"});
  }
}

// Lot B : liste des demandes d'indisponibilité filtrée par le serveur selon les sections du compte.
async function availabilityRequests(req,res){
  res.setHeader("Cache-Control","private, no-store");
  try {
    const query=req.query??{};
    if(Object.keys(query).some(key=>!["view","schoolYearId"].includes(key)))throw new AvailabilityRequestApiError(400,"invalid-argument","Paramètres de consultation invalides.");
    const authorization=req.headers.authorization??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
    if(!token)throw new AvailabilityRequestApiError(401,"unauthenticated","Authentification requise.");
    const{auth,db}=initAdmin(),caller=await verifyActorIdToken(auth,token);
    await requireActiveApiUser(db,caller);
    if(caller.role!=="study_director"||!caller.schoolId)throw new AvailabilityRequestApiError(403,"permission-denied","Seule la Direction des études peut consulter ces demandes.");
    await enforceApiRateLimit({db,actorId:caller.uid,schoolId:caller.schoolId,action:"school.availability-requests.read",...API_RATE_LIMITS.PUBLISHED_TIMETABLE});
    return send(res,200,{requests:await listAvailabilityRequests({db,caller,schoolYearId:query.schoolYearId})});
  } catch(error) {
    if(sendRateLimitError(res,error))return;
    if(error instanceof AvailabilityRequestApiError)return send(res,error.status,{error:error.message,code:error.code});
    if(error?.statusCode===401||error?.statusCode===403)return send(res,error.statusCode,{error:error.message,code:error.code});
    console.error("[Acadéa indisponibilités] Lecture échouée.",{code:typeof error?.code==="string"?error.code:"internal"});
    return send(res,500,{error:"Chargement impossible. Veuillez réessayer.",code:"internal"});
  }
}
