import { teacherTabs, type TeacherTab } from "./teacherNavigation";

export function TeacherBottomNavigation({ activeTab, onTab }: { activeTab: TeacherTab; onTab: (tab: TeacherTab) => void }) {
  return <nav aria-label="Navigation Enseignant" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:px-2">
    <div className="mx-auto grid w-full max-w-2xl grid-cols-4 gap-1">{teacherTabs.map((tab) => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} type="button" aria-current={active ? "page" : undefined} onClick={() => onTab(tab.id)} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-2 text-[10px] font-semibold transition min-[360px]:text-[11px] sm:px-1 sm:text-xs ${active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}><Icon className="h-5 w-5 shrink-0"/><span className="max-w-full truncate">{tab.label}</span></button>; })}</div>
  </nav>;
}
