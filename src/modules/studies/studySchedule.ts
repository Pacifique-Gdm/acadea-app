import type { SchedulePeriod, StudyDay, TeacherAvailability, Timetable, TimetableEntry } from "./studyTypes";
export const STUDY_DAYS: StudyDay[]=["monday","tuesday","wednesday","thursday","friday","saturday"];
export const DAY_LABELS:Record<StudyDay,string>={monday:"Lundi",tuesday:"Mardi",wednesday:"Mercredi",thursday:"Jeudi",friday:"Vendredi",saturday:"Samedi"};
const ALL_DAY_LABELS: Record<string, string> = { ...DAY_LABELS, sunday: "Dimanche" };
const STUDY_DAY_ORDER: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
export function studyDayLabel(day: string) { return ALL_DAY_LABELS[day] ?? day; }
export function schedulePeriodLabel(periodId: string, periods: SchedulePeriod[]) {
  const period = periods.find((item) => item.id === periodId);
  if (!period) return "Période inconnue";
  const coursePeriods = periods.filter((item) => item.active && item.type === "course" && (item.vacation ?? "morning") === (period.vacation ?? "morning") && (item.dayScope ?? "weekdays") === (period.dayScope ?? "weekdays")).sort((left, right) => left.order - right.order || left.startTime.localeCompare(right.startTime));
  const courseIndex = coursePeriods.findIndex((item) => item.id === period.id);
  const periodNumber = courseIndex >= 0 ? courseIndex + 1 : period.order;
  const timeRange = period.startTime && period.endTime ? `${period.startTime} – ${period.endTime}` : "";
  return [`Période ${periodNumber}`, timeRange].filter(Boolean).join(" — ");
}
export function sortTimetableEntriesForDisplay(entries: TimetableEntry[], periods: SchedulePeriod[]) {
  const periodById = new Map(periods.map((period) => [period.id, period]));
  return [...entries].sort((left, right) => {
    const leftPeriod = periodById.get(left.periodId);
    const rightPeriod = periodById.get(right.periodId);
    return (STUDY_DAY_ORDER[left.dayOfWeek] ?? Number.MAX_SAFE_INTEGER) - (STUDY_DAY_ORDER[right.dayOfWeek] ?? Number.MAX_SAFE_INTEGER)
      || (leftPeriod?.order ?? Number.MAX_SAFE_INTEGER) - (rightPeriod?.order ?? Number.MAX_SAFE_INTEGER)
      || (leftPeriod?.startTime ?? "").localeCompare(rightPeriod?.startTime ?? "")
      || left.classId.localeCompare(right.classId)
      || left.teacherId.localeCompare(right.teacherId)
      || left.subjectId.localeCompare(right.subjectId)
      || left.id.localeCompare(right.id);
  });
}
export function completedStudyTimetables(items: Timetable[]) {
  return items.filter((item) => item.persistenceState !== "PENDING");
}
export function currentStudyTimetable(items: Timetable[]) {
  const visible = completedStudyTimetables(items);
  return visible.find((item) => item.activeDraft) ?? visible.find((item) => item.activePublished) ?? visible[0];
}
export const minutes=(value:string)=>{const [h,m]=value.split(":").map(Number);return h*60+m;};
export function validTimeRange(start?:string,end?:string){return Boolean(start&&end&&/^\d{2}:\d{2}$/.test(start)&&/^\d{2}:\d{2}$/.test(end)&&minutes(start)<minutes(end));}
export function overlaps(a:{startTime?:string;endTime?:string},b:{startTime?:string;endTime?:string}){return Boolean(a.startTime&&a.endTime&&b.startTime&&b.endTime&&minutes(a.startTime)<minutes(b.endTime)&&minutes(b.startTime)<minutes(a.endTime));}
export function detectAvailabilityConflicts(items:TeacherAvailability[]){return items.some((a,i)=>items.some((b,j)=>j>i&&a.teacherId===b.teacherId&&a.dayOfWeek===b.dayOfWeek&&a.active&&b.active&&(a.status==="rest"||b.status==="rest"||overlaps(a,b))));}
export function validateAvailabilityRanges(status:TeacherAvailability["status"],ranges:Array<{startTime:string;endTime:string}>){if(status==="rest"&&ranges.length)return "Un jour de repos ne peut pas contenir de plage horaire.";for(const range of ranges){if(!range.startTime||!range.endTime)return "Chaque plage doit comporter une heure de début et de fin.";if(!validTimeRange(range.startTime,range.endTime))return "L’heure de fin doit être postérieure à l’heure de début.";}for(let i=0;i<ranges.length;i+=1)for(let j=i+1;j<ranges.length;j+=1)if(ranges[i].startTime===ranges[j].startTime&&ranges[i].endTime===ranges[j].endTime)return "Une même plage ne peut pas être ajoutée deux fois.";else if(overlaps(ranges[i],ranges[j]))return "Deux plages de la même journée ne peuvent pas se chevaucher.";return "";}
export function phase3DashboardMetrics(items:TeacherAvailability[],periods:SchedulePeriod[]){const active=items.filter(x=>x.active);return{teachersWithUnavailability:new Set(active.filter(x=>x.status==="unavailable").map(x=>x.teacherId)).size,teachersWithRestDays:new Set(active.filter(x=>x.status==="rest").map(x=>x.teacherId)).size,activeCoursePeriods:periods.filter(x=>x.active&&x.type==="course").length,activeNonTeachingPeriods:periods.filter(x=>x.active&&x.type!=="course").length};}
export function isRestDay(teacherId:string,day:StudyDay,items:TeacherAvailability[]){return items.some(x=>x.teacherId===teacherId&&x.dayOfWeek===day&&x.active&&x.status==="rest");}
export function teacherAvailableAt(teacherId:string,day:StudyDay,period:SchedulePeriod,items:TeacherAvailability[]){const dayItems=items.filter(x=>x.teacherId===teacherId&&x.dayOfWeek===day&&x.active);if(dayItems.some(x=>x.status==="rest"))return false;const unavailable=dayItems.filter(x=>x.status==="unavailable");if(unavailable.some(x=>!x.startTime||overlaps(x,period)))return false;const available=dayItems.filter(x=>x.status==="available");return available.length===0||available.some(x=>!x.startTime||(minutes(x.startTime)<=minutes(period.startTime)&&minutes(x.endTime!)>=minutes(period.endTime)));}
export const getActiveCoursePeriods=(items:SchedulePeriod[])=>items.filter(x=>x.active&&x.type==="course").sort((a,b)=>a.order-b.order||minutes(a.startTime)-minutes(b.startTime));
export const getNonTeachingPeriods=(items:SchedulePeriod[])=>items.filter(x=>x.active&&x.type!=="course").sort((a,b)=>a.order-b.order||minutes(a.startTime)-minutes(b.startTime));
const isTraversableTeachingBreak=(period:SchedulePeriod)=>period.type==="break"||period.type==="recess";
export function arePeriodsPedagogicallyConsecutive(periods: readonly SchedulePeriod[], allPeriods: readonly SchedulePeriod[]) {
  if (periods.length <= 1) return periods.length === 1 && periods[0].active && periods[0].type === "course";
  const first = periods[0];
  const template = allPeriods.filter((item) => item.active && (item.vacation ?? "morning") === (first.vacation ?? "morning") && (item.dayScope ?? "weekdays") === (first.dayScope ?? "weekdays")).sort((left, right) => left.order - right.order || minutes(left.startTime) - minutes(right.startTime));
  if (!periods.every((period) => period.active && period.type === "course" && (period.vacation ?? "morning") === (first.vacation ?? "morning") && (period.dayScope ?? "weekdays") === (first.dayScope ?? "weekdays"))) return false;
  return periods.every((period, index) => {
    if (index === 0) return true;
    const previousIndex = template.findIndex((item) => item.id === periods[index - 1].id);
    const currentIndex = template.findIndex((item) => item.id === period.id);
    if (previousIndex < 0 || currentIndex <= previousIndex) return false;
    const sequence = template.slice(previousIndex, currentIndex + 1);
    return sequence.slice(1, -1).every(isTraversableTeachingBreak)
      && sequence.every((item, sequenceIndex) => sequenceIndex === 0 || sequence[sequenceIndex - 1].endTime === item.startTime);
  });
}
export function maxConsecutiveCoursePeriods(items: readonly SchedulePeriod[]) {
  const active = items.filter((item) => item.active && item.type === "course");
  let maximum = active.length ? 1 : 0;
  for (const first of active) {
    const sameTemplate = active.filter((item) => (item.vacation ?? "morning") === (first.vacation ?? "morning") && (item.dayScope ?? "weekdays") === (first.dayScope ?? "weekdays")).sort((left, right) => left.order - right.order || minutes(left.startTime) - minutes(right.startTime));
    const start = sameTemplate.findIndex((item) => item.id === first.id);
    for (let size = 2; start >= 0 && start + size <= sameTemplate.length; size += 1) if (arePeriodsPedagogicallyConsecutive(sameTemplate.slice(start, start + size), items)) maximum = Math.max(maximum, size);
  }
  return maximum;
}
export function validatePeriod(candidate:SchedulePeriod,items:SchedulePeriod[],ignored?:string){if(!candidate.vacation)return "La vacation est obligatoire.";if(!validTimeRange(candidate.startTime,candidate.endTime))return "L’heure de fin doit être postérieure à l’heure de début.";const sameTemplate=(x:SchedulePeriod)=>x.id!==ignored&&x.active&&(x.vacation??"morning")===candidate.vacation&&(x.dayScope??"weekdays")===(candidate.dayScope??"weekdays");if(items.some(x=>sameTemplate(x)&&x.order===candidate.order))return "Cet ordre est déjà utilisé dans cette vacation.";if(items.some(x=>sameTemplate(x)&&overlaps(x,candidate)))return "Cette tranche chevauche une période de la même vacation.";return "";}
