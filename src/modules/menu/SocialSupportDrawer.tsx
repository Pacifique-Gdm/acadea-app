import type { ReactNode } from "react";
import { SupportStudentPicker } from "./SupportStudentPicker";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { AdminDrawer, MoneyInput } from "../../components/ui";
import {
  subscribeSupport,
  subscribeSupportContext,
  reconcileSupport,
  saveSupport,
  loadSupportPersonnel,
  type SupportDecision,
} from "../../services/socialSupport";
import {
  subscribeToSchoolPersonnel,
  subscribeToServicePersonnel,
  personnelRoleLabels,
} from "../../services/personnel";
import { getApplicableFeeTypes } from "../../utils/stats";
import {
  supportAmount,
  supportBalance,
  supportReductionCeiling,
  supportCeilingMessage,
} from "../../../api/_lib/socialSupportMath.js";
import { toMoneyMinor, fromMoneyMinor } from "../../utils/money";
import {
  formatCurrencyMoney,
  resolveSchoolYearCurrency,
} from "../../utils/currency";
import { pdfTable, renderAcadPdfPreview } from "../../utils/pdf";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

const supportReasons: Record<string, string> = {
  social: "Cas social",
  scholarship: "Bourse scolaire",
  direction: "Décision de la direction",
  personnel: "Personnel de l’école",
  "third-party": "Décision historique",
  other: "Autre motif",
};
const natures: Record<string, string> = {
  fixed: "Réduction en montant fixe",
  percent: "Réduction en pourcentage",
  full: "Exonération totale",
};
export function SocialSupportDrawer({
  user,
  school,
  years,
  data: initialData,
  readOnly = false,
  scopeSchools,
  editingDecision,
  onEdited,
  onDirtyChange,
}: {
  user: AppUser;
  school: School;
  years: SchoolYear[];
  data: Pick<AppData, "students" | "feeTypes" | "payments">;
  readOnly?: boolean;
  scopeSchools?: School[];
  editingDecision?: SupportDecision;
  onEdited?: (decision: SupportDecision) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const scopedSchools = scopeSchools?.length ? scopeSchools : [school];
  const scopeIds = scopedSchools.map((item) => item.id);
  const scopeKey = scopeIds.join("|");
  const [data, setData] = useState(initialData);
  const [contextReady, setContextReady] = useState(false);
  const [tab, setTab] = useState("Bénéficiaires"),
    [decisions, setDecisions] = useState<SupportDecision[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; role?: string; kind?: "service"; jobTitle?: string }>>([]),
    [staff, setStaff] = useState<Array<{ id: string; name: string; role?: string; kind?: "service"; jobTitle?: string }>>([]);
  const [studentId, setStudentId] = useState(editingDecision?.studentId ?? ""),
    [studentQuery, setStudentQuery] = useState(""),
    [nature, setNature] = useState(editingDecision?.nature ?? "fixed"),
    [reason, setReason] = useState(editingDecision?.reason ?? ""),
    [personnelId, setPersonnelId] = useState(editingDecision?.personnelId ?? ""),
    [thirdPartyName, setThirdPartyName] = useState(editingDecision?.thirdPartyName ?? ""),
    [observation, setObservation] = useState(editingDecision?.observation ?? ""),
    [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(editingDecision?.lines ?? {}).map(([id, line]) => [id, String(line.value)]))),
    [editing, setEditing] = useState<SupportDecision | null>(editingDecision ?? null);
  const [editTarget, setEditTarget] = useState<SupportDecision | null>(null);
  const [editDirty, setEditDirty] = useState(false);
  const initialEditFingerprint = useRef(JSON.stringify([nature, reason, personnelId, thirdPartyName, observation, values]));
  useLayoutEffect(() => {
    onDirtyChange?.(busy || initialEditFingerprint.current !== JSON.stringify([nature, reason, personnelId, thirdPartyName, observation, values]));
  }, [busy, nature, reason, personnelId, thirdPartyName, observation, values, onDirtyChange]);
  const [search, setSearch] = useState(""),
    [filterSchool, setFilterSchool] = useState(""),
    [filterYear, setFilterYear] = useState(""),
    [filterClass, setFilterClass] = useState(""),
    [filterFee, setFilterFee] = useState(""),
    [filterReason, setFilterReason] = useState(""),
    [filterStatus, setFilterStatus] = useState(""),
    [filterAction, setFilterAction] = useState("");
  const [detail, setDetail] = useState<SupportDecision | null>(null);
  const request = useRef({ fingerprint: "", id: "" });
  const [editConfirmation, setEditConfirmation] = useState("");
  const [confirmEditOpen, setConfirmEditOpen] = useState(false);
  const [filterCriterion, setFilterCriterion] = useState("year");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(editingDecision ? [editingDecision.studentId] : []);
  const batchRequests = useRef(new Map<string, string>());
  const savingRef = useRef(false);
  useEffect(() => {
    if (readOnly) return;
    void reconcileSupport().catch((e) =>
      setError(e instanceof Error ? e.message : "Actualisation impossible."),
    );
  }, [school.id, readOnly]);
  useEffect(() => {
    const snapshots = new Map<string, SupportDecision[]>();
    setLoading(true);
    const stops = scopeKey.split("|").filter(Boolean).map((id) => subscribeSupport(id, (rows) => {
      snapshots.set(id, rows);
      setDecisions([...snapshots.values()].flat());
      if (snapshots.size === scopeKey.split("|").filter(Boolean).length) setLoading(false);
    }, (cause) => { setError(cause.message); setLoading(false); }));
    return () => stops.forEach((stop) => stop());
  }, [scopeKey]);
  useEffect(() => {
    if (readOnly) return;
    if (user.role === "cashier" || user.role === "secretary") {
      void loadSupportPersonnel().then(setAccounts).catch((cause) => setError(cause instanceof Error ? cause.message : "Personnel indisponible."));
      return;
    }
    const onError = (e: Error) => setError(e.message);
    const a = subscribeToSchoolPersonnel({
      user,
      schoolId: school.id,
      onData: setAccounts,
      onError,
    });
    const b = subscribeToServicePersonnel({
      user,
      schoolId: school.id,
      onData: setStaff,
      onError,
    });
    return () => {
      a();
      b();
    };
  }, [user, school.id, readOnly]);
  useEffect(() => { if (readOnly) setData(initialData); }, [initialData, readOnly]);
  useEffect(() => {
    if (readOnly) { setContextReady(true); return; }
    const ready = new Set<string>();
    return subscribeSupportContext(
      school.id,
      (patch) => {
        Object.keys(patch).forEach((k) => ready.add(k));
        setData((old) => ({ ...old, ...patch }));
        setContextReady(ready.size === 3);
      },
      (e) => {
        setContextReady(false);
        setError(e.message);
      },
    );
  }, [school.id, readOnly]);
  const year = years.find(
    (y) =>
      y.id === school.activeSchoolYearId &&
      y.schoolId === school.id &&
      y.status === "active",
  );
  const currency = resolveSchoolYearCurrency(year, school);
  const money = (value: number) => formatCurrencyMoney(value, currency);
  const students = data.students.filter(
    (s) =>
      s.schoolId === school.id &&
      s.schoolYearId === year?.id &&
      s.status === "ACTIVE",
  );
  const student = students.find((s) => s.id === studentId);
  const fees = useMemo(
    () =>
      student
        ? getApplicableFeeTypes(
            student,
            data.feeTypes.filter(
              (f) => f.schoolId === school.id && f.schoolYearId === year?.id,
            ),
          )
        : [],
    [student, data.feeTypes, school.id, year?.id],
  );
  const balances = useMemo(() => {
    if (!student) return [];
    const financialSupport = { ...student.financialSupport };
    if (editing) delete financialSupport[editing.id];
    return fees.map((fee) => ({
      fee,
      balance: supportBalance(
        { ...student, financialSupport },
        fee,
        data.payments,
      ),
    }));
  }, [student, fees, data.payments, editing]);
  const preview = balances
    .filter(({ fee }) => Object.hasOwn(values, fee.id))
    .map(({ fee, balance }) => {
      try {
        const raw = values[fee.id];
        if (
          nature !== "full" &&
          (!raw.trim() || !/^\d+(?:\.\d{1,2})?$/.test(raw))
        )
          throw new Error("Saisir un nombre valide.");
        const ceiling = supportReductionCeiling(balance);
        const basis = toMoneyMinor(reason === "third-party" ? balance.studentRemaining : Math.max(0, balance.net - balance.commitment));
        const amountMinor = supportAmount(nature, Number(raw), basis);
        if (amountMinor > ceiling) throw new Error(supportCeilingMessage(ceiling, currency));
        const amount = fromMoneyMinor(amountMinor);
        const net = balance.net - (reason === "third-party" ? 0 : amount);
        return {
          fee,
          balance,
          amount,
          net,
          remaining: Math.max(0, net - balance.paid),
          error: "",
        };
      } catch (e) {
        return {
          fee,
          balance,
          amount: 0,
          net: balance.net,
          remaining: balance.remaining,
          error: e instanceof Error ? e.message : "Valeur invalide.",
        };
      }
    });
  const yearValid =
    year?.endsAt &&
    Number.isFinite(Date.parse(year.endsAt)) &&
    Date.parse(`${year.endsAt.slice(0, 10)}T23:59:59Z`) >= Date.now();
  const valid =
    contextReady &&
    student &&
    preview.length > 0 &&
    reason &&
    preview.every((p) => !p.error) &&
    yearValid &&
    (reason !== "personnel" || personnelId) &&
    (reason !== "third-party" || thirdPartyName.trim()) &&
    !busy;
  const status = (d: SupportDecision) =>
    d.status === "cancelled"
      ? "Annulée"
      : d.status === "expired"
        ? "Expirée"
        : years.find((y) => y.id === d.schoolYearId)?.status === "archived" ||
            Date.parse(`${d.validUntil.slice(0, 10)}T23:59:59Z`) < Date.now()
          ? "Expirée"
          : "Active";
  const filtered = decisions.filter((d) => {
    const text = [
      d.studentName,
      d.matricule,
      d.className,
      supportReasons[d.reason],
      ...Object.keys(d.lines).map(
        (id) => data.feeTypes.find((f) => f.id === id)?.name ?? id,
      ),
    ]
      .join(" ")
      .toLocaleLowerCase("fr");
    return (
      scopeIds.includes(d.schoolId) &&
      (!filterSchool || d.schoolId === filterSchool) &&
      (!filterYear || d.schoolYearId === filterYear) &&
      (!filterClass || d.className === filterClass) &&
      (!filterFee || d.lines[filterFee]) &&
      (!filterReason || d.reason === filterReason) &&
      (!filterStatus || status(d) === filterStatus) &&
      text.includes(search.toLocaleLowerCase("fr"))
    );
  });
  function decisionFinances(d: SupportDecision) {
    const pupil = data.students.find(
      (s) => s.id === d.studentId && s.schoolId === d.schoolId,
    );
    if (!pupil) return "Données financières indisponibles";
    return Object.entries(d.lines)
      .map(([id, line]) => {
        const fee = data.feeTypes.find(
          (f) => f.id === id && f.schoolId === d.schoolId,
        ) ?? {
          id,
          schoolId: d.schoolId,
          schoolYearId: d.schoolYearId,
          name: line.feeName,
          amount: line.officialMinor / 100,
        };
        const b = supportBalance(pupil, fee, data.payments);
        const fmt = (n: number) => formatCurrencyMoney(n, d.currency);
        return `${line.feeName ?? "Frais historique"} : officiel ${fmt(b.official)} ; réductions ${fmt(b.reduction)} ; encaissé ${fmt(b.paid)} ; solde ${fmt(b.remaining)}`;
      })
      .join(" | ");
  }
  const history = filtered
    .flatMap((d) => d.history.map((event) => ({ decision: d, event })))
    .filter((row) => !filterAction || row.event.action === filterAction)
    .sort((a, b) => b.event.at.localeCompare(a.event.at));
  function reset() {
    setConfirmEditOpen(false);
    setEditConfirmation("");
    setSelectedStudentIds([]);
    setEditing(null);
    setStudentId("");
    setValues({});
    setReason("");
    setPersonnelId("");
    setThirdPartyName("");
    setObservation("");
    setNature("fixed");
  }
  async function mutate(input: Record<string, unknown>) {
    if (readOnly || busy || savingRef.current) return;
    savingRef.current = true;
    if (!editing && selectedStudentIds.length > 1) {
      setBusy(true);
      setError("");
      setSuccess("");
      const failures: string[] = [];
      const failedIds: string[] = [];
      let completed = 0;
      for (const id of [...new Set(selectedStudentIds)]) {
        const pupil = students.find((item) => item.id === id);
        try {
          if (!pupil) throw new Error("Élève indisponible dans le périmètre autorisé.");
          const applicable = getApplicableFeeTypes(pupil, data.feeTypes.filter((fee) => fee.schoolId === school.id && fee.schoolYearId === year?.id));
          const lines = preview.map(({ fee }) => {
            const matches = applicable.filter((candidate) => candidate.name === fee.name);
            if (matches.length !== 1) throw new Error(`Frais ${fee.name} absent ou ambigu pour cet élève.`);
            return { feeTypeId: matches[0].id, value: Number(values[fee.id]) };
          });
          const payload = { ...input, studentId: id, lines };
          const fingerprint = JSON.stringify(payload);
          let key = batchRequests.current.get(fingerprint);
          if (!key) { key = crypto.randomUUID(); batchRequests.current.set(fingerprint, key); }
          // The server checks this student's eligibility, remaining balance,
          // scope and fee locks in its own transaction; never reuse a decision.
          const decision = await saveSupport({ ...payload, clientRequestId: key });
          setDecisions((rows) => [...rows.filter((item) => item.id !== decision.id), decision]);
          completed++;
        } catch (cause) {
          failedIds.push(id);
          failures.push(`${pupil ? `${pupil.nom} ${pupil.prenom}` : "Élève indisponible"} : ${cause instanceof Error ? cause.message : "Confirmation indisponible"}`);
        }
      }
      setSuccess(`${completed} décision(s) confirmée(s) par le serveur.`);
      setError(failures.join("\n"));
      // Keep the selection and per-student request keys on partial failure:
      // a retry replays confirmed transactions instead of duplicating them.
      if (!failedIds.length) { reset(); setTab("Bénéficiaires"); }
      setBusy(false);
      savingRef.current = false;
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const fingerprint = JSON.stringify(input);
    if (request.current.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const decision = await saveSupport({
        ...input,
        clientRequestId: request.current.id,
      });
      setDecisions((rows) => [
        ...rows.filter((d) => d.id !== decision.id),
        decision,
      ]);
      setSuccess("Prise en charge confirmée par le serveur.");
      if (editingDecision) {
        onEdited?.(decision);
        return;
      }
      reset();
      setTab("Bénéficiaires");
      request.current = { fingerprint: "", id: "" };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
      savingRef.current = false;
    }
  }
  async function exportPdf() {
    setBusy(true);
    setError("");
    const title =
      tab === "Historique"
        ? "Historique des prises en charge"
        : "Liste des bénéficiaires";
    const pdfSchool = scopedSchools.length > 1
      ? { ...school, name: "Établissements de la coordination", address: "", phone: "", email: "", logoUrl: undefined }
      : school;
    try {
      await renderAcadPdfPreview({
        filename: `prises-en-charge-${tab}.pdf`,
        title,
        school: pdfSchool,
        year: years.find((y) => y.id === filterYear),
        subtitle: `Recherche : ${search || "Toutes"} · Classe : ${filterClass || "Toutes"} · Frais : ${filterFee || "Tous"} · Motif : ${supportReasons[filterReason] || "Tous"} · Statut : ${filterStatus || "Tous"} · Opération : ${filterAction || "Toutes"}`,
        throwOnError: true,
        orientation: "landscape",
        sections: [
          tab === "Historique"
            ? pdfTable(
                [
                  ...(scopedSchools.length > 1 ? [{ header: "Établissement", render: (r: { decision: SupportDecision }) => scopedSchools.find((item) => item.id === r.decision.schoolId)?.name ?? r.decision.schoolId }] : []),
                  {
                    header: "Élève",
                    render: (r) =>
                      r.decision.studentName,
                  },
                  { header: "Opération", render: (r) => r.event.action },
                  {
                    header: "Date",
                    render: (r) => new Date(r.event.at).toLocaleString("fr"),
                  },
                  { header: "Auteur", render: (r) => `${r.event.actorName} (${r.event.actorRole ?? "rôle historique inconnu"})` },
                  {
                    header: "Montants (unités monétaires)",
                    render: (r) =>
                      Object.values(r.event.after.lines)
                        .map(
                          (l) =>
                            `${formatCurrencyMoney(l.reductionMinor / 100, r.decision.currency)} de réduction`,
                        )
                        .join("; "),
                  },
                  { header: "Devise", render: (r) => r.decision.currency },
                  { header: "Statut", render: (r) => status(r.decision) },
                ],
                history,
                "Aucune opération.",
              )
            : pdfTable(
                [
                  ...(scopedSchools.length > 1 ? [{ header: "Établissement", render: (d: SupportDecision) => scopedSchools.find((item) => item.id === d.schoolId)?.name ?? d.schoolId }] : []),
                  {
                    header: "Élève / classe",
                    render: (d) => `${d.studentName} / ${d.className}`,
                  },
                  {
                    header: "Année",
                    render: (d) =>
                      years.find((y) => y.id === d.schoolYearId)?.name ??
                      d.schoolYearId,
                  },
                  {
                    header: "Frais / officiel / réduction",
                    render: (d) =>
                      Object.entries(d.lines)
                        .map(
                          ([id, l]) =>
                            `${data.feeTypes.find((f) => f.id === id)?.name ?? l.feeName ?? "Frais historique"}: ${formatCurrencyMoney(l.officialMinor / 100, d.currency)} / ${formatCurrencyMoney(l.reductionMinor / 100, d.currency)}`,
                        )
                        .join("; "),
                  },
                  {
                    header: "Encaissé et soldes",
                    render: (d) => decisionFinances(d),
                  },
                  { header: "Devise", render: (d) => d.currency },
                  { header: "Statut", render: (d) => status(d) },
                ],
                filtered,
                "Aucun bénéficiaire.",
              ),
        ],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export impossible.");
    } finally {
      setBusy(false);
    }
  }
  function edit(d: SupportDecision) {
    if (readOnly || d.schoolId !== school.id || d.schoolYearId !== year?.id || status(d) !== "Active") return;
    setEditDirty(false);
    setEditTarget(d);
  }
  return (
    <div className="grid min-w-0 gap-4">
      {!editingDecision && <div role="tablist" className={`grid gap-1 ${readOnly ? "grid-cols-2" : "grid-cols-3"}`}>
        {(readOnly ? ["Bénéficiaires", "Historique"] : ["Bénéficiaires", "Nouveau", "Historique"]).map(
          (t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`${tab === t ? "primary-button" : "secondary-button"} min-w-0 !px-1 text-xs sm:text-sm`}
              onClick={() => { setTab(t); if (t !== "Historique" && filterCriterion === "action") setFilterCriterion("year"); }}
            >
              {t}
            </button>
          ),
        )}
      </div>}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-green-700">
          {success}
        </p>
      )}
      {(tab === "Nouveau" || editingDecision) && !readOnly ? (
        <>
          <section className="grid gap-2">
            <h3 className="font-bold">1. Élève bénéficiaire</h3>
            <SupportStudentPicker students={students} selectedIds={selectedStudentIds} query={studentQuery} onQuery={setStudentQuery}
              loading={!contextReady} disabled={!!editing || busy} onChange={(ids) => {
                setSelectedStudentIds(ids);
                if ((ids[0] ?? "") !== studentId) { setStudentId(ids[0] ?? ""); setValues({}); }
              }} />
            {student && (
              <p>
                {student.nom} {student.postnom} {student.prenom} ·{" "}
                {student.matricule} · {student.className}
              </p>
            )}
          </section>
          <section className="grid gap-2">
            <h3 className="font-bold">2. Frais concernés</h3>
            {balances.map(({ fee, balance }) => (
              <label key={fee.id} className="flex gap-2">
                <input
                  type="checkbox"
                  checked={Object.hasOwn(values, fee.id)}
                  onChange={(e) =>
                    setValues((old) => {
                      const next = { ...old };
                      if (e.target.checked) next[fee.id] = "";
                      else delete next[fee.id];
                      return next;
                    })
                  }
                />
                <span>
                  {fee.name} — Officiel : {money(fee.amount)} — Montant maximal de réduction :{" "}
                  {money(fromMoneyMinor(supportReductionCeiling(balance)))} · Réductions déjà accordées : {money(balance.reduction)} · Paiements : {money(balance.paid)} · Solde restant : {money(balance.remaining)}
                </span>
              </label>
            ))}
            {student && !fees.length && <p>Aucun frais applicable.</p>}
          </section>
          <section className="grid gap-2">
            <h3 className="font-bold">3. Nature de l’avantage</h3>
            <select
              aria-label="Nature de l’avantage"
              className="input"
              value={nature}
              onChange={(e) => {
                setNature(e.target.value);
                setValues((old) =>
                  Object.fromEntries(Object.keys(old).map((id) => [id, ""])),
                );
              }}
            >
              {Object.entries(natures).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {preview.map((p) => (
              <div key={p.fee.id}>
                <Field
                  label={`${p.fee.name} — ${nature === "percent" ? "Pourcentage entier" : "Montant"}`}
                >
                  {nature === "full" ? (
                    <p>{money(p.amount)}</p>
                  ) : nature === "percent" ? (
                    <input
                      className="input"
                      inputMode="numeric"
                      value={values[p.fee.id]}
                      onChange={(e) => {
                        if (
                          /^\d{0,3}$/.test(e.target.value) &&
                          Number(e.target.value) <= 100
                        )
                          setValues({ ...values, [p.fee.id]: e.target.value });
                      }}
                    />
                  ) : (
                    <MoneyInput
                      value={values[p.fee.id]}
                      onChange={(value) => {
                        const normalized = value.replace(",", ".");
                        if (!normalized || /^\d*(?:\.\d{0,2})?$/.test(normalized))
                          setValues({ ...values, [p.fee.id]: normalized });
                      }}
                    />
                  )}
                </Field>
                {p.error && (
                  <p role="alert" className="text-red-700">
                    {p.error}
                  </p>
                )}
              </div>
            ))}
          </section>
          <section className="grid gap-2">
            <h3 className="font-bold">4. Motif et décision administrative</h3>
            <Field label="Motif de l’avantage *">
              <select
                className="input"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setPersonnelId("");
                  setThirdPartyName("");
                }}
              >
                <option value="">Sélectionner un motif</option>
                {Object.entries(supportReasons).filter(([id]) => id !== "third-party" || editing?.reason === "third-party").map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {reason === "personnel" && (
              <Field label="Personnel concerné *">
                <select
                  className="input"
                  value={personnelId}
                  onChange={(e) => setPersonnelId(e.target.value)}
                >
                  <option value="">Sélectionner un personnel</option>
                  {[...accounts, ...staff].map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} —{" "}
                      {p.kind === "service"
                        ? p.jobTitle
                        : (personnelRoleLabels[
                            p.role as keyof typeof personnelRoleLabels
                          ] ?? p.role)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Observation administrative">
              <textarea
                className="input"
                maxLength={2000}
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
              />
            </Field>
          </section>
          <section className="grid gap-2">
            <h3 className="font-bold">5. Validité et récapitulatif</h3>
            <p>Année scolaire : {year?.name ?? "Aucune année active"}</p>
            <p>Valable jusqu’au : Clôture de l'année active</p>
            {!yearValid && (
              <p role="alert">
                La clôture officielle est absente ou l’année est clôturée.
                Confirmation impossible.
              </p>
            )}
            {preview.map((p) => (
              <article key={p.fee.id} className="rounded border p-3">
                <strong>{p.fee.name}</strong>
                <p>
                  Officiel : {money(p.fee.amount)} · Réductions antérieures :{" "}
                  {money(p.balance.reduction)}
                </p>
                <p>
                  Nouvel avantage : {money(p.amount)}{" "}
                  {reason !== "third-party" && "(réduction)"}
                </p>
                <p>
                  Net exigible : {money(p.net)} · Encaissé :{" "}
                  {money(p.balance.paid)} · Solde : {money(p.remaining)}
                </p>
              </article>
            ))}
            <p>
              Total officiel : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.fee.amount),0)))} · Réductions antérieures : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.balance.reduction),0)))} · Nouvel avantage : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.amount),0)))} · Encaissé : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.balance.paid),0)))} · Total net :{" "}
              {money(
                fromMoneyMinor(
                  preview.reduce((s, p) => s + toMoneyMinor(p.net), 0),
                ),
              )}{" "}
              · Solde :{" "}
              {money(
                fromMoneyMinor(
                  preview.reduce((s, p) => s + toMoneyMinor(p.remaining), 0),
                ),
              )}
            </p>
          </section>
          {editing && (
            <p>
              Chaque modification est conservée dans l’historique.
            </p>
          )}
          {editing && confirmEditOpen && <Field label="Saisissez JE CONFIRME LA MODIFICATION">
            <input className="input" autoComplete="off" value={editConfirmation} onChange={(event) => setEditConfirmation(event.target.value)} />
          </Field>}
          <button
            className="primary-button w-full"
            disabled={!valid || (!!editing && confirmEditOpen && editConfirmation !== "JE CONFIRME LA MODIFICATION")}
            onClick={() => {
              if (editing && (!confirmEditOpen || editConfirmation !== "JE CONFIRME LA MODIFICATION")) {
                setConfirmEditOpen(true);
                return;
              }
              void mutate({
                action: "save-social-support",
                studentId,
                schoolYearId: year?.id,
                nature,
                reason,
                personnelId,
                thirdPartyName,
                observation,
                lines: preview.map((p) => ({
                  feeTypeId: p.fee.id,
                  value: Number(values[p.fee.id]),
                })),
                ...(editing
                  ? { decisionId: editing.id, expectedVersion: editing.version, confirmation: editConfirmation }
                  : {}),
              });
            }}
          >
            {busy ? "Enregistrement…" : editing ? (confirmEditOpen ? "Confirmer la modification" : "Modifier") : "Confirmer la prise en charge"}
          </button>
          {!editingDecision && <button className="secondary-button" disabled={busy} onClick={reset}>
            Réinitialiser le formulaire
          </button>}
        </>
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-1">
            <input
              aria-label="Rechercher les décisions"
              className="input min-w-0 flex-1"
              placeholder="Recherche"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="secondary-button order-4 !px-2"
              disabled={loading || busy || !contextReady}
              onClick={() => void exportPdf()}
            >
              PDF
            </button>
            <select aria-label="Filtres" className="input order-2 min-w-0 !px-1 text-xs" value={filterCriterion} onChange={(event) => setFilterCriterion(event.target.value)}>
              <option value="year">Année scolaire</option><option value="class">Classe</option><option value="fee">Frais</option><option value="reason">Motif</option><option value="status">Statut</option>
              {scopedSchools.length > 1 && <option value="school">Établissement</option>}
              {tab === "Historique" && <option value="action">Opération</option>}
            </select>
            {scopedSchools.length > 1 && <select hidden={filterCriterion !== "school"} aria-label="Établissement" title="Choix" className="input order-3 min-w-0 !px-1 text-xs" value={filterSchool} onChange={(event) => setFilterSchool(event.target.value)}><option value="">Tous les établissements</option>{scopedSchools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            <select
              hidden={filterCriterion !== "year"}
              aria-label="Année scolaire"
              title="Choix"
              className="input order-3 min-w-0 !px-1 text-xs"
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
            >
              <option value="">Toutes les années</option>
              {years
                .filter((y) => scopeIds.includes(y.schoolId) && (!filterSchool || y.schoolId === filterSchool))
                .map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
            </select>
            <select
              hidden={filterCriterion !== "class"}
              aria-label="Classe"
              title="Choix"
              className="input order-3 min-w-0 !px-1 text-xs"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            >
              <option value="">Toutes les classes</option>
              {[...new Set(decisions.map((d) => d.className))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              hidden={filterCriterion !== "fee"}
              aria-label="Frais"
              title="Choix"
              className="input order-3 min-w-0 !px-1 text-xs"
              value={filterFee}
              onChange={(e) => setFilterFee(e.target.value)}
            >
              <option value="">Tous les frais</option>
              {data.feeTypes
                .filter((f) => scopeIds.includes(f.schoolId) && (!filterSchool || f.schoolId === filterSchool))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
            <select
              hidden={filterCriterion !== "reason"}
              aria-label="Motif"
              title="Choix"
              className="input order-3 min-w-0 !px-1 text-xs"
              value={filterReason}
              onChange={(e) => setFilterReason(e.target.value)}
            >
              <option value="">Tous les motifs</option>
              {Object.entries(supportReasons).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              hidden={filterCriterion !== "status"}
              aria-label="Statut"
              title="Choix"
              className="input order-3 min-w-0 !px-1 text-xs"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">Tous les statuts</option>
              {["Active", "Annulée", "Expirée"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {tab === "Historique" && (
              <select
                hidden={filterCriterion !== "action"}
                aria-label="Opération"
                title="Choix"
                className="input order-3 min-w-0 !px-1 text-xs"
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
              >
                <option value="">Toutes les opérations</option>
                <option value="create">Création</option>
                <option value="update">Modification</option>
                <option value="cancel">Annulation</option>
                <option value="expire">Expiration</option>
                <option value="validity-update">Clôture modifiée</option>
              </select>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs" aria-label="Filtres actifs">
            {[
              { value: filterSchool, label: scopedSchools.find((item) => item.id === filterSchool)?.name, clear: () => setFilterSchool("") },
              { value: filterYear, label: years.find((item) => item.id === filterYear)?.name, clear: () => setFilterYear("") },
              { value: filterClass, label: filterClass, clear: () => setFilterClass("") },
              { value: filterFee, label: data.feeTypes.find((item) => item.id === filterFee)?.name, clear: () => setFilterFee("") },
              { value: filterReason, label: supportReasons[filterReason], clear: () => setFilterReason("") },
              { value: filterStatus, label: filterStatus, clear: () => setFilterStatus("") },
              { value: tab === "Historique" ? filterAction : "", label: filterAction, clear: () => setFilterAction("") },
            ].map((item, index) => item.value && <button key={index} className="rounded bg-slate-100 px-2 py-1" onClick={item.clear} aria-label={`Retirer le filtre ${item.label}`}>{item.label || "Filtre actif"} ×</button>)}
          </div>
          {loading ? (
            <p>Chargement…</p>
          ) : tab === "Historique" ? (
            history.map(({ decision, event }) => (
              <article className="rounded border p-3" key={event.id}>
                <strong>
                  {decision.studentName} — {event.action}
                </strong>
                <p>
                  {new Date(event.at).toLocaleString("fr")} · {event.actorName} ({event.actorRole ?? "rôle historique inconnu"}){" "}
                  · {decision.id}
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setDetail(event.after)}
                >
                  Consulter les nouvelles valeurs
                </button>
                {event.before && (
                  <button
                    className="secondary-button"
                    onClick={() => setDetail(event.before)}
                  >
                    Anciennes valeurs
                  </button>
                )}
              </article>
            ))
          ) : (
            filtered.map((d) => (
              <article className="grid gap-2 rounded border p-3" key={d.id}>
                <strong>
                  {scopedSchools.length > 1 && `${scopedSchools.find((item) => item.id === d.schoolId)?.name ?? d.schoolId} — `}{d.studentName} — {d.matricule} — {d.className}
                </strong>
                <p>
                  {years.find((y) => y.id === d.schoolYearId)?.name} ·{" "}
                  {supportReasons[d.reason]} · {status(d)} · Clôture de l’année
                  active
                </p>
                {Object.entries(d.lines).map(([id, l]) => (
                  <p key={id}>
                    {data.feeTypes.find((f) => f.id === id)?.name ?? id} :
                    officiel{" "}
                    {formatCurrencyMoney(l.officialMinor / 100, d.currency)} ·
                    réduction{" "}
                    {formatCurrencyMoney(l.reductionMinor / 100, d.currency)}
                  </p>
                ))}
                <p>{decisionFinances(d)}</p>
                <div className="grid gap-2">
                  {!readOnly && <button
                    className="secondary-button w-full"
                    disabled={
                      busy ||
                      status(d) !== "Active" ||
                      d.schoolYearId !== year?.id
                    }
                    onClick={() => edit(d)}
                  >
                    Modifier
                  </button>}
                </div>
              </article>
            ))
          )}
          {!loading &&
            (tab === "Historique" ? history.length : filtered.length) === 0 && (
              <p>Aucun résultat.</p>
            )}
        </>
      )}
      {editTarget && !readOnly && <AdminDrawer title="Modifier la décision sociale" closeLabel="Fermer la modification sociale"
        onClose={() => { if (!editDirty || window.confirm("Abandonner les modifications non enregistrées ?")) setEditTarget(null); }}>
        <SocialSupportDrawer key={`${editTarget.id}:${editTarget.version}`} user={user} school={school} years={years} data={data}
          editingDecision={editTarget} onDirtyChange={setEditDirty} onEdited={(decision) => {
            setDecisions((rows) => rows.map((row) => row.id === decision.id ? decision : row));
            setDetail((current) => current?.id === decision.id ? decision : current);
            setSuccess("Modification confirmée par le serveur."); setEditTarget(null);
          }} />
      </AdminDrawer>}
      {detail && (
        <section className="rounded border p-4">
          <h3 className="font-bold">{detail.studentName} — {detail.className}</h3>
          <p>{scopedSchools.find((item) => item.id === detail.schoolId)?.name} · {years.find((item) => item.id === detail.schoolYearId)?.name}</p>
          <p>
            {supportReasons[detail.reason]} · {natures[detail.nature]}
          </p>
          <p>{status(detail)}</p>
          {detail.observation && <p className="whitespace-pre-wrap">{detail.observation}</p>}
          {Object.entries(detail.lines).map(([id, l]) => (
            <p key={id}>
              {data.feeTypes.find((fee) => fee.id === id)?.name ?? l.feeName ?? "Frais historique"} : réduction {formatCurrencyMoney(l.reductionMinor / 100, detail.currency)}
            </p>
          ))}
          <button className="secondary-button" onClick={() => setDetail(null)}>
            Fermer les détails
          </button>
        </section>
      )}
    </div>
  );
}
