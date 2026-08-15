import { useEffect, useState } from "react";
import type { AppUser } from "../../types";
import type { PedagogicalDocument, TeacherStudentObservation, TeachingProgressEntry } from "./teacherLearning";
import { subscribeTeacherLearning } from "./teacherLearningService";

export function useTeacherLearning(user:AppUser,schoolId:string,schoolYearId:string,teacherId?:string){const[state,setState]=useState<{progress:TeachingProgressEntry[];observations:TeacherStudentObservation[];documents:PedagogicalDocument[];loading:boolean;error:string}>({progress:[],observations:[],documents:[],loading:true,error:""});useEffect(()=>{if(!teacherId)return;setState(current=>({...current,loading:true,error:""}));try{return subscribeTeacherLearning(user,schoolId,schoolYearId,teacherId,value=>setState({...value,loading:false,error:""}),error=>setState(current=>({...current,loading:false,error:error.message})));}catch(error){setState(current=>({...current,loading:false,error:error instanceof Error?error.message:"Chargement impossible."}));return;}},[schoolId,schoolYearId,teacherId,user]);return state;}
