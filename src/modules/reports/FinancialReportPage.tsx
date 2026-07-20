import { ArrowLeft } from "lucide-react";
import { ReportsModule } from "./ReportsModule";
import type { AppData, AppUser, Expense, FeeType, ParentProfile, Payment, School, SchoolYear, Student } from "../../types";

type FinancialReportYearData = {
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
};

type FinancialReportPageProps = {
  user: AppUser;
  data: AppData;
  yearData: FinancialReportYearData;
  school: School;
  year: SchoolYear;
  onBack: () => void;
};

export function FinancialReportPage({ user, data, yearData, school, year, onBack }: FinancialReportPageProps) {
  return (
    <section className="grid min-w-0 gap-4">
      <div className="mb-4 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={onBack} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white text-slate-600 transition hover:bg-slate-50 hover:text-ink" aria-label="Retour au menu" title="Retour au menu">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="break-words text-2xl font-bold text-ink">Rapport financier</h1>
        </div>
        <p className="mt-1 break-words text-sm text-slate-500">Rapports financiers dédiés à l'année scolaire sélectionnée.</p>
      </div>
      <ReportsModule user={user} data={data} yearData={yearData} school={school} year={year} />
    </section>
  );
}
