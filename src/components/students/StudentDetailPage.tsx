import { useMemo, useState } from "react";
import { Download, Plus, Search, UserMinus } from "lucide-react";
import { ActionSnackbar, AdminDrawer, FormPanel, Metric } from "../ui";
import { unlinkParentFromStudent } from "../../services/provisioning";
import { createAuditLog } from "../../utils/audit";
import { buildSchoolYearDataIndexes } from "../../utils/dataIndexes";
import { resolvePaymentCashierName } from "../../utils/finance";
import { generateReceiptPdf } from "../../utils/pdf";
import { getStudentFeeSummaries } from "../../utils/studentFeeSummary";
import { formatStudentClassName } from "../../utils/studentClasses";
import { isArchivedStudent } from "../../utils/studentUtils";
import { applyParentUnlinkResult, isExactParentUnlinkConfirmation, PARENT_UNLINK_CONFIRMATION } from "../../utils/parentStudentLink";
import type { AppData, AppUser, ParentProfile, School, SchoolYear } from "../../types";

type StudentDetailYearData = Pick<AppData, "students" | "parents" | "feeTypes" | "payments" | "auditLogs">;

export function StudentDetailPage({
  studentId,
  user,
  data,
  yearData,
  year,
  school,
  updateData,
  onBack,
  createId,
  formatArchiveDate,
  canLinkParent = true,
}: {
  studentId: string;
  user: AppUser;
  data: AppData;
  yearData: StudentDetailYearData;
  year: SchoolYear;
  school: School;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onBack: () => void;
  createId: (prefix: string) => string;
  formatArchiveDate: (value?: string) => string;
  canLinkParent?: boolean;
}) {
  const [parentLinkOpen, setParentLinkOpen] = useState(false);
  const [parentLinkSearch, setParentLinkSearch] = useState("");
  const [parentUnlinkOpen, setParentUnlinkOpen] = useState(false);
  const [parentUnlinkConfirmation, setParentUnlinkConfirmation] = useState("");
  const [parentUnlinkError, setParentUnlinkError] = useState("");
  const [parentUnlinkBusy, setParentUnlinkBusy] = useState(false);
  const [parentFeedback, setParentFeedback] = useState("");
  const detailIndexes = useMemo(() => buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments), [yearData.students, yearData.feeTypes, yearData.payments]);
  const student = detailIndexes.studentsById.get(studentId);
  const parentLinkResults = useMemo(() => {
    const search = parentLinkSearch.trim().toLocaleLowerCase("fr");
    if (!search) return [];
    return yearData.parents.filter((parent) => {
      if (parent.schoolId !== school.id) return false;
      const text = `${parent.fullName} ${parent.phone} ${parent.email} ${parent.address}`.toLocaleLowerCase("fr");
      return text.includes(search);
    });
  }, [parentLinkSearch, school.id, yearData.parents]);

  function linkStudentToParent(parent: ParentProfile) {
    if (!student || !canManageParentLink || parent.schoolId !== school.id) return;
    const parents = data.parents.map((item) => {
      const withoutStudent = item.studentIds.filter((studentId) => studentId !== student.id);
      return item.id === parent.id ? { ...item, studentIds: Array.from(new Set([...withoutStudent, student.id])) } : { ...item, studentIds: withoutStudent };
    });
    const users = data.users.map((item) => {
      if (item.role !== "parent" || !item.parentId) return item;
      const nextParent = parents.find((parentItem) => parentItem.id === item.parentId);
      return nextParent ? { ...item, studentIds: nextParent.studentIds } : item;
    });
    updateData({
      students: data.students.map((item) => (item.id === student.id ? { ...item, parentId: parent.id } : item)),
      parents,
      users,
      auditLogs: [
        createAuditLog(user, school.id, student.schoolYearId, "Liaison parent élève", `${student.matricule} - ${student.nom} ${student.prenom} → ${parent.fullName}`, createId),
        ...data.auditLogs,
      ],
    });
    setParentLinkOpen(false);
    setParentLinkSearch("");
    setParentFeedback("Le parent a été lié à cet élève.");
  }

  if (!student) {
    return (
      <section className="grid gap-4">
        <button onClick={onBack} className="secondary-button w-fit">← Retour à la liste des élèves</button>
        <FormPanel title="Élève introuvable">
          <p className="text-sm text-slate-500">Aucun élève ne correspond à ce dossier dans l'année scolaire sélectionnée.</p>
        </FormPanel>
      </section>
    );
  }

  const feeSummaries = getStudentFeeSummaries(student, yearData.feeTypes, yearData.payments, detailIndexes);
  const balance = feeSummaries.reduce(
    (totals, summary) => ({
      expected: totals.expected + summary.expected,
      paid: totals.paid + summary.paid,
      remaining: totals.remaining + summary.remaining,
    }),
    { expected: 0, paid: 0, remaining: 0 },
  );
  const payments = detailIndexes.paymentsByStudentId.get(student.id) ?? [];
  const parent = yearData.parents.find((item) => item.id === student.parentId);
  const canManageParentLink = canLinkParent
    && (user.role === "school_admin" || user.role === "secretary")
    && user.schoolId === school.id;
  const progress = balance.expected > 0 ? Math.min(100, Math.round((balance.paid / balance.expected) * 100)) : 0;
  const archived = isArchivedStudent(student);

  function openParentUnlink() {
    if (!parent || !canManageParentLink) return;
    setParentUnlinkConfirmation("");
    setParentUnlinkError("");
    setParentUnlinkOpen(true);
  }

  function closeParentUnlink() {
    if (parentUnlinkBusy) return;
    setParentUnlinkOpen(false);
    setParentUnlinkConfirmation("");
    setParentUnlinkError("");
  }

  async function confirmParentUnlink() {
    if (!student || !parent || parentUnlinkBusy) return;
    if (!isExactParentUnlinkConfirmation(parentUnlinkConfirmation)) {
      setParentUnlinkError(`Veuillez saisir exactement ${PARENT_UNLINK_CONFIRMATION}.`);
      return;
    }

    setParentUnlinkBusy(true);
    setParentUnlinkError("");
    const studentIdToUnlink = student.id;
    const parentIdToUnlink = parent.id;
    try {
      const result = await unlinkParentFromStudent({
        schoolId: school.id,
        schoolYearId: year.id,
        studentId: studentIdToUnlink,
        parentId: parentIdToUnlink,
        confirmation: parentUnlinkConfirmation,
      });
      updateData(applyParentUnlinkResult(data, {
        studentId: studentIdToUnlink,
        parentId: parentIdToUnlink,
        parentStudentIds: result.parentStudentIds,
      }), { persist: false });
      setParentUnlinkOpen(false);
      setParentUnlinkConfirmation("");
      setParentFeedback("Le parent a été délié de cet élève.");
    } catch (error) {
      setParentUnlinkError(error instanceof Error ? error.message : "Déliaison du parent impossible.");
    } finally {
      setParentUnlinkBusy(false);
    }
  }

  return (
    <section className="grid min-w-0 gap-4">
      <button onClick={onBack} className="secondary-button w-fit">← Retour à la liste des élèves</button>
      <ActionSnackbar message={parentFeedback} onClose={() => setParentFeedback("")} />

      <article className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-2xl font-bold text-ink">
            {student.photoUrl ? <img src={student.photoUrl} alt="" className="h-full w-full object-cover" /> : student.prenom.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold text-ink">{student.nom} {student.postnom} {student.prenom}</h1>
            <p className="break-words text-sm text-slate-500">{student.matricule} | {formatStudentClassName(student)} | {year.name}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{formatStudentClassName(student)}</span>
              <span className={`rounded px-2 py-1 text-xs font-semibold ${archived ? "bg-slate-200 text-slate-700" : "bg-mint/10 text-mint"}`}>
                {archived ? "Archivé" : "Actif"}
              </span>
            </div>
          </div>
        </div>
      </article>

      <section className="grid min-w-0 gap-4">
        <FormPanel title="Informations générales">
          <Metric label="Sexe" value={student.sexe} />
          <Metric label="Date de naissance" value={student.birthDate} />
          <Metric label="Adresse" value={student.address} />
          {parent && canManageParentLink ? (
            <div className="min-w-0 rounded border border-slate-100 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Parent</p>
              <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="break-words font-semibold text-ink">{parent.fullName}</p>
                <button onClick={openParentUnlink} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 sm:w-auto" type="button">
                  <UserMinus className="h-4 w-4" /> Délier le parent
                </button>
              </div>
            </div>
          ) : parent ? (
            <Metric label="Parent" value={parent.fullName} />
          ) : canManageParentLink ? (
            <div className="min-w-0 rounded border border-slate-100 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Parent</p>
              <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="break-words font-semibold text-ink">Non renseigné</p>
                <button onClick={() => setParentLinkOpen(true)} className="primary-button w-full justify-center sm:w-auto" type="button">
                  <Plus className="h-4 w-4" /> Lier à un parent
                </button>
              </div>
            </div>
          ) : <Metric label="Parent" value="Non renseigné" />}
          {archived && (
            <>
              <Metric label="Motif d'archivage" value={student.exitReasonDetails ?? student.exitReason ?? "Motif non renseigné"} />
              <Metric label="Date d'archivage" value={formatArchiveDate(student.deletedAt)} />
            </>
          )}
        </FormPanel>

        <FormPanel title="Paiements">
          <Metric label="Total frais" value={`$${balance.expected}`} />
          <Metric label="Total payé" value={`$${balance.paid}`} />
          <Metric label="Solde" value={`$${balance.remaining}`} />
          <div className="h-3 overflow-hidden rounded bg-slate-100">
            <div className="h-full rounded bg-mint" style={{ width: `${progress}%` }} />
          </div>
        </FormPanel>

        <FormPanel title="Historique des paiements">
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement enregistré.</p>}
            {payments.map((payment) => {
              const fee = detailIndexes.feeTypesById.get(payment.feeTypeId);
              return (
                <div key={payment.id} className="min-w-0 rounded border border-slate-100 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{fee?.name ?? "Frais"}</p>
                    <button onClick={() => fee && generateReceiptPdf(payment, student, fee, school, resolvePaymentCashierName(payment, yearData.auditLogs))} className="rounded bg-slate-100 p-2" title="Voir le reçu PDF">
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="break-words text-slate-500">${payment.amount} | {payment.paidAt} | {payment.cashierName}</p>
                </div>
              );
            })}
          </div>
        </FormPanel>
      </section>
      {canManageParentLink && parentLinkOpen && (
        <AdminDrawer title="Lier à un parent" onClose={() => setParentLinkOpen(false)} closeLabel="Fermer la liaison parent">
          <div className="grid gap-3">
            <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={parentLinkSearch}
                onChange={(event) => setParentLinkSearch(event.target.value)}
                className="min-w-0 flex-1 outline-none"
                placeholder="Rechercher un parent"
              />
            </label>
            {!parentLinkSearch.trim() && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Saisissez un nom, téléphone, email ou adresse pour rechercher un parent.</p>}
            {parentLinkSearch.trim() && parentLinkResults.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun parent trouvé.</p>}
            <div className="grid gap-2">
              {parentLinkResults.map((parentItem) => (
                <button
                  key={parentItem.id}
                  onClick={() => linkStudentToParent(parentItem)}
                  className="min-w-0 rounded border border-slate-200 bg-white p-3 text-left transition hover:border-ink hover:bg-slate-50"
                  type="button"
                >
                  <span className="block break-words font-semibold text-ink">{parentItem.fullName}</span>
                  <span className="mt-1 block break-words text-sm text-slate-500">{parentItem.phone || "Téléphone non renseigné"} · {parentItem.email || "Email non renseigné"}</span>
                  {parentItem.address && <span className="mt-1 block break-words text-xs text-slate-400">{parentItem.address}</span>}
                </button>
              ))}
            </div>
          </div>
        </AdminDrawer>
      )}
      {canManageParentLink && parent && parentUnlinkOpen && (
        <AdminDrawer title="Délier le parent" onClose={closeParentUnlink} closeLabel="Fermer la confirmation de déliaison">
          <div className="grid gap-4">
            <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p>Vous êtes sur le point de délier <strong>{parent.fullName}</strong> de l’élève <strong>{student.nom} {student.postnom} {student.prenom}</strong>.</p>
              <p className="mt-2">Cette action supprimera uniquement leur relation. Le compte Parent et ses liens avec d’autres enfants seront conservés.</p>
              <p className="mt-2">Pour confirmer, saisissez exactement : <strong>{PARENT_UNLINK_CONFIRMATION}</strong></p>
            </div>
            <label className="grid gap-1 text-sm font-semibold">
              Confirmation
              <input
                className="input"
                value={parentUnlinkConfirmation}
                disabled={parentUnlinkBusy}
                placeholder={PARENT_UNLINK_CONFIRMATION}
                onChange={(event) => setParentUnlinkConfirmation(event.target.value)}
              />
            </label>
            {parentUnlinkError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{parentUnlinkError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="secondary-button justify-center" disabled={parentUnlinkBusy} onClick={closeParentUnlink}>Annuler</button>
              <button
                type="button"
                className="rounded bg-red-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={parentUnlinkBusy || !isExactParentUnlinkConfirmation(parentUnlinkConfirmation)}
                onClick={() => void confirmParentUnlink()}
              >
                {parentUnlinkBusy ? "Déliaison…" : "Confirmer la déliaison"}
              </button>
            </div>
          </div>
        </AdminDrawer>
      )}
    </section>
  );
}
