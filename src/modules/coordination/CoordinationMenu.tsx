import { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarRange, FileClock, Landmark, Settings, UsersRound } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { Coordination, School } from "../../types";
import { loadCoordinationReadModel, type CoordinationReadModel } from "../../services/coordinationReadModel";
import { closeCoordinationSchoolYears, loadCoordinationSchoolYearStatus, openCoordinationSchoolYears, type CoordinationSchoolYearRow } from "../../services/coordinationSchoolYears";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { activityTimestamp, formatActivityDateTime } from "../../utils/activityHistory";

type Drawer = "fees" | "finance" | "personnel" | "years" | "settings" | "history";
const emptyModel: CoordinationReadModel = { feeTypes: [], payments: [], expenses: [], personnel: [], schoolYears: [], auditLogs: [] };
const roleLabel: Record<string, string> = { school_admin: "Administrateur", cashier: "Caissier", discipline_director: "Directeur de discipline", study_director: "Directeur des études", secretary: "Secrétaire", teacher: "Enseignant", parent: "Parent" };

export function CoordinationMenu({ coordination, schools, selectedSchoolId, principalCoordinatorName }: { coordination: Coordination; schools: School[]; selectedSchoolId: string; principalCoordinatorName: string }) {
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [model, setModel] = useState<CoordinationReadModel>(emptyModel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [personnelRole, setPersonnelRole] = useState("");
  const [personnelStatus, setPersonnelStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [yearRows, setYearRows] = useState<CoordinationSchoolYearRow[]>([]);
  const [referenceYear, setReferenceYear] = useState<string | null>(null);
  const [yearName, setYearName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [yearBusy, setYearBusy] = useState(false);
  const [yearResults, setYearResults] = useState<Array<{ schoolId: string; status: string; reason?: string }>>([]);
  const schoolIds = useMemo(() => selectedSchoolId ? [selectedSchoolId] : schools.map((item) => item.id), [schools, selectedSchoolId]);

  useEffect(() => {
    if (!drawer) return; let cancelled = false; setLoading(true); setError("");
    loadCoordinationReadModel(coordination.id, schoolIds).then((result) => { if (!cancelled) setModel(result); }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Chargement impossible."); }).finally(() => { if (!cancelled) setLoading(false); });
    if (drawer === "years") loadCoordinationSchoolYearStatus().then((result) => { if (!cancelled) { setYearRows(result.rows.filter((row) => schoolIds.includes(row.schoolId))); setReferenceYear(result.referenceYear); } }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Années indisponibles."); });
    return () => { cancelled = true; };
  }, [coordination.id, drawer, schoolIds]);

  async function refreshYears() {
    try { const result = await loadCoordinationSchoolYearStatus(); setYearRows(result.rows.filter((row) => schoolIds.includes(row.schoolId))); setReferenceYear(result.referenceYear); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Années indisponibles."); }
  }
  const schoolName = (schoolId?: string) => schools.find((item) => item.id === schoolId)?.name ?? schoolId ?? "—";
  const fees = model.feeTypes.filter((item) => schoolIds.includes(item.schoolId));
  const payments = model.payments.filter((item) => schoolIds.includes(item.schoolId) && (!from || item.paidAt >= from) && (!to || item.paidAt <= to));
  const expenses = model.expenses.filter((item) => schoolIds.includes(item.schoolId) && (!from || item.spentAt >= from) && (!to || item.spentAt <= to));
  const personnel = model.personnel.filter((item) => {
    const inactive = item.active === false || item.status === "inactive";
    const itemRole = String(item.role);
    return schoolIds.includes(item.schoolId ?? "")
      && (!personnelRole || itemRole === personnelRole || (personnelRole === "school_admin" && itemRole === "admin"))
      && (!personnelStatus || (personnelStatus === "inactive" ? inactive : !inactive))
      && `${item.name} ${item.email ?? ""} ${item.role}`.toLowerCase().includes(search.toLowerCase());
  });
  const logs = model.auditLogs.filter((item) => (item.coordinationId === coordination.id || !item.schoolId || schoolIds.includes(item.schoolId)) && `${item.action} ${item.actorName ?? ""} ${item.details ?? ""}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => activityTimestamp(b.createdAt) - activityTimestamp(a.createdAt));
  const currencyOf = (schoolId: string) => schools.find((item) => item.id === schoolId)?.currency ?? "USD";
  const financialByCurrency = [...new Set([...payments.map((item) => currencyOf(item.schoolId)), ...expenses.map((item) => currencyOf(item.schoolId))])].sort().map((currency) => {
    const income = payments.filter((item) => currencyOf(item.schoolId) === currency).reduce((sum, item) => sum + item.amount, 0);
    const spending = expenses.filter((item) => currencyOf(item.schoolId) === currency).reduce((sum, item) => sum + item.amount, 0);
    return { currency, income, spending, balance: income - spending };
  });
  const formatAmount = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;

  async function exportPdf(kind: Exclude<Drawer, "settings">) {
    const school = schools.find((item) => item.id === selectedSchoolId) ?? schools[0]; if (!school) return;
    const context = selectedSchoolId ? school.name : "Toutes les écoles";
    const sections = kind === "fees" ? [pdfSection("Types de frais", pdfTable([{ header: "École", render: (item) => schoolName(item.schoolId) }, { header: "Type", render: (item) => item.name }, { header: "Montant", render: (item) => formatAmount(item.amount, currencyOf(item.schoolId)) }], fees, "Aucun type de frais."))]
      : kind === "finance" ? [pdfSection("Synthèse", pdfTable([{ header: "Devise", render: (item) => item.currency }, { header: "Recettes", render: (item) => formatAmount(item.income, item.currency) }, { header: "Dépenses", render: (item) => formatAmount(item.spending, item.currency) }, { header: "Solde", render: (item) => formatAmount(item.balance, item.currency) }], financialByCurrency, "Aucune opération.")), pdfSection("Paiements", pdfTable([{ header: "École", render: (item) => schoolName(item.schoolId) }, { header: "Date", render: (item) => item.paidAt }, { header: "Montant", render: (item) => formatAmount(item.amount, currencyOf(item.schoolId)) }], payments, "Aucun paiement.")), pdfSection("Dépenses", pdfTable([{ header: "École", render: (item) => schoolName(item.schoolId) }, { header: "Date", render: (item) => item.spentAt }, { header: "Montant", render: (item) => formatAmount(item.amount, currencyOf(item.schoolId)) }], expenses, "Aucune dépense."))]
      : kind === "personnel" ? [pdfSection("Personnels", pdfTable([{ header: "École", render: (item) => schoolName(item.schoolId) }, { header: "Nom", render: (item) => item.name }, { header: "Fonction", render: (item) => roleLabel[item.role] ?? item.role }, { header: "Statut", render: (item) => item.active === false || item.status === "inactive" ? "Inactif" : "Actif" }], personnel, "Aucun personnel."))]
      : kind === "years" ? [pdfSection("Années scolaires", pdfTable([{ header: "École", render: (item) => item.schoolName }, { header: "Année active", render: (item) => item.activeYear?.name ?? "Aucune" }, { header: "Alignement", render: (item) => !referenceYear || item.activeYear?.name === referenceYear ? "Alignée" : "Année scolaire non alignée" }], yearRows, "Aucune école."))]
      : [pdfSection("Historique", pdfTable([{ header: "Date", render: (item) => formatActivityDateTime(item.createdAt) }, { header: "École", render: (item) => schoolName(item.schoolId) }, { header: "Action", render: (item) => escapePdfHtml(item.action) }, { header: "Acteur", render: (item) => item.actorName ?? "—" }], logs, "Aucune activité."))];
    await renderAcadPdfPreview({ filename: `coordination-${kind}-${selectedSchoolId || "toutes"}.pdf`, title: `Coordination — ${kind}`, school, subtitle: context, sections });
  }

  async function mutateYears(action: "close" | "open") {
    if (yearBusy || !window.confirm(action === "close" ? "Confirmer la clôture des années prêtes ?" : "Confirmer l’ouverture de la nouvelle année ?")) return;
    setYearBusy(true); setError("");
    try { const response = action === "close" ? await closeCoordinationSchoolYears() : await openCoordinationSchoolYears({ name: yearName, startsAt, endsAt }); setYearResults(response.results); await refreshYears(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Opération impossible."); }
    finally { setYearBusy(false); }
  }

  const items = [
    ["fees", "Types de frais", BookOpen], ["finance", "Rapport financier", Landmark], ["personnel", "Personnels", UsersRound], ["years", "Année scolaire", CalendarRange], ["settings", "Paramètres coordination", Settings], ["history", "Historique", FileClock],
  ] as const;
  return <section className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => { setDrawer(id); setSearch(""); }} className="flex items-center gap-3 rounded border bg-white p-4 text-left shadow-sm hover:border-blue-300"><Icon className="h-5 w-5 text-blue-700"/><span className="font-semibold">{label}</span></button>)}</div>{drawer && <AdminDrawer title={items.find(([id]) => id === drawer)?.[1] ?? "Coordination"} closeLabel="Fermer" onClose={() => setDrawer(null)}>{error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}{loading && <p className="text-sm text-slate-500">Chargement…</p>}{drawer === "fees" && <><button className="pdf-export-button" type="button" onClick={() => void exportPdf("fees")}>Exporter PDF</button><ReadTable headers={["École", "Type", "Montant"]} rows={fees.map((item) => [schoolName(item.schoolId), String(item.name), formatAmount(item.amount, currencyOf(item.schoolId))])}/></>}{drawer === "finance" && <><div className="grid grid-cols-2 gap-2"><input className="input" aria-label="Date de début" type="date" value={from} onChange={(event) => setFrom(event.target.value)}/><input className="input" aria-label="Date de fin" type="date" value={to} onChange={(event) => setTo(event.target.value)}/></div><ReadTable headers={["Devise", "Recettes", "Dépenses", "Solde"]} rows={financialByCurrency.map((item) => [item.currency, formatAmount(item.income, item.currency), formatAmount(item.spending, item.currency), formatAmount(item.balance, item.currency)])}/><button className="pdf-export-button" type="button" onClick={() => void exportPdf("finance")}>Exporter PDF</button><h3 className="font-semibold">Paiements</h3><ReadTable headers={["École", "Date", "Montant"]} rows={payments.map((item) => [schoolName(item.schoolId), item.paidAt, formatAmount(item.amount, currencyOf(item.schoolId))])}/><h3 className="font-semibold">Dépenses</h3><ReadTable headers={["École", "Date", "Catégorie", "Montant"]} rows={expenses.map((item) => [schoolName(item.schoolId), item.spentAt, item.category, formatAmount(item.amount, currencyOf(item.schoolId))])}/></>}{drawer === "personnel" && <><div className="grid gap-2 sm:grid-cols-3"><input className="input" placeholder="Rechercher" value={search} onChange={(event) => setSearch(event.target.value)}/><select className="input" aria-label="Filtrer par rôle" value={personnelRole} onChange={(event) => setPersonnelRole(event.target.value)}><option value="">Tous rôles</option>{Object.entries(roleLabel).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select><select className="input" aria-label="Filtrer par statut" value={personnelStatus} onChange={(event) => setPersonnelStatus(event.target.value)}><option value="">Tous statuts</option><option value="active">Actifs</option><option value="inactive">Inactifs</option></select></div><button className="pdf-export-button" type="button" onClick={() => void exportPdf("personnel")}>Exporter PDF</button><ReadTable headers={["École", "Nom", "Fonction", "Statut"]} rows={personnel.map((item) => [schoolName(item.schoolId), item.name, roleLabel[item.role] ?? item.role, item.active === false || item.status === "inactive" ? "Inactif" : "Actif"])}/></>}{drawer === "years" && <><p className="rounded bg-blue-50 p-3 text-sm">Année de référence : <b>{referenceYear ?? "Non définie"}</b></p><button className="pdf-export-button" type="button" onClick={() => void exportPdf("years")}>Exporter PDF</button><ReadTable headers={["École", "Année active", "Alignement", "Préparation"]} rows={yearRows.map((item) => [item.schoolName, item.activeYear?.name ?? "Aucune", !referenceYear || item.activeYear?.name === referenceYear ? "Alignée" : "Année scolaire non alignée", item.readinessError ? `Bloquée : ${item.readinessError}` : item.activeYear ? "Prête à clôturer" : "Prête à ouvrir"])}/>{yearResults.length > 0 && <ReadTable headers={["École", "Résultat", "Motif"]} rows={yearResults.map((item) => [schoolName(item.schoolId), item.status, item.reason ?? "—"])}/>}<button className="secondary-button w-full justify-center" disabled={yearBusy} type="button" onClick={() => void mutateYears("close")}>Clôturer les années prêtes</button><div className="grid gap-2 rounded border p-3"><input className="input" placeholder="2027-2028" value={yearName} onChange={(event) => setYearName(event.target.value)}/><input className="input" aria-label="Début de l'année" type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)}/><input className="input" aria-label="Fin de l'année" type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)}/><button className="primary-button justify-center" disabled={yearBusy || !yearName || !startsAt || !endsAt} type="button" onClick={() => void mutateYears("open")}>Ouvrir la nouvelle année</button></div></>}{drawer === "settings" && <div className="grid gap-2 text-sm"><p><b>Nom :</b> {coordination.name}</p><p><b>Sigle :</b> {coordination.code || "—"}</p><p><b>Téléphone :</b> {coordination.phone || "—"}</p><p><b>E-mail :</b> {coordination.email || "—"}</p><p><b>Adresse :</b> {coordination.address || "—"}</p><p><b>Coordinateur principal :</b> {principalCoordinatorName || "Non renseigné"}</p><p><b>Écoles :</b> {schools.length}</p><p className="rounded bg-slate-50 p-3">Le rattachement des écoles reste réservé au Super Administrateur.</p></div>}{drawer === "history" && <><input className="input" placeholder="Rechercher" value={search} onChange={(event) => setSearch(event.target.value)}/><button className="pdf-export-button" type="button" onClick={() => void exportPdf("history")}>Exporter PDF</button><ReadTable headers={["Date", "École", "Action", "Acteur"]} rows={logs.map((item) => [formatActivityDateTime(item.createdAt), schoolName(item.schoolId), item.action, item.actorName ?? "—"])}/></>}</AdminDrawer>}</section>;
}

function ReadTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b">{headers.map((header) => <th key={header} className="p-2">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${index}-${row.join("-")}`} className="border-b">{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className="p-2">{cell}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune donnée.</p>}</div>;
}
