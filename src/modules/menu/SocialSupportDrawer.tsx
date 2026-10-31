import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { MoneyInput } from "../../components/ui";
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
  "third-party": "Prise en charge par un tiers",
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
}: {
  user: AppUser;
  school: School;
  years: SchoolYear[];
  data: Pick<AppData, "students" | "feeTypes" | "payments">;
  readOnly?: boolean;
  scopeSchools?: School[];
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
  const [studentId, setStudentId] = useState(""),
    [studentQuery, setStudentQuery] = useState(""),
    [nature, setNature] = useState("fixed"),
    [reason, setReason] = useState(""),
    [personnelId, setPersonnelId] = useState(""),
    [thirdPartyName, setThirdPartyName] = useState(""),
    [observation, setObservation] = useState(""),
    [values, setValues] = useState<Record<string, string>>({}),
    [editing, setEditing] = useState<SupportDecision | null>(null);
  const [search, setSearch] = useState(""),
    [filterSchool, setFilterSchool] = useState(""),
    [filterYear, setFilterYear] = useState(""),
    [filterClass, setFilterClass] = useState(""),
    [filterFee, setFilterFee] = useState(""),
    [filterReason, setFilterReason] = useState(""),
    [filterStatus, setFilterStatus] = useState(""),
    [filterAction, setFilterAction] = useState("");
  const [detail, setDetail] = useState<SupportDecision | null>(null),
    [cancelTarget, setCancelTarget] = useState<SupportDecision | null>(null);
  const request = useRef({ fingerprint: "", id: "" });
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
        return `${line.feeName ?? id} : officiel ${fmt(b.official)} ; réductions ${fmt(b.reduction)} ; tiers ${fmt(b.commitment)} ; encaissé ${fmt(b.paid)} ; solde ${fmt(b.remaining)}`;
      })
      .join(" | ");
  }
  const history = filtered
    .flatMap((d) => d.history.map((event) => ({ decision: d, event })))
    .filter((row) => !filterAction || row.event.action === filterAction)
    .sort((a, b) => b.event.at.localeCompare(a.event.at));
  function reset() {
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
    if (busy) return;
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
      reset();
      setTab("Bénéficiaires");
      setCancelTarget(null);
      request.current = { fingerprint: "", id: "" };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
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
                    header: "Élève / décision",
                    render: (r) =>
                      `${r.decision.studentName} / ${r.decision.id}`,
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
                            `${l.reductionMinor / 100} réduction / ${l.commitmentMinor / 100} engagement`,
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
                    header: "Frais / officiel / réduction / tiers",
                    render: (d) =>
                      Object.entries(d.lines)
                        .map(
                          ([id, l]) =>
                            `${data.feeTypes.find((f) => f.id === id)?.name ?? id}: ${l.officialMinor / 100} / ${l.reductionMinor / 100} / ${l.commitmentMinor / 100}`,
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
    setEditing(d);
    setStudentId(d.studentId);
    setNature(d.nature);
    setReason(d.reason);
    setPersonnelId(d.personnelId ?? "");
    setThirdPartyName(d.thirdPartyName);
    setObservation(d.observation);
    setValues(
      Object.fromEntries(
        Object.entries(d.lines).map(([id, l]) => [id, String(l.value)]),
      ),
    );
    setTab("Nouvelle prise en charge");
  }
  return (
    <div className="grid min-w-0 gap-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {(readOnly ? ["Bénéficiaires", "Historique"] : ["Bénéficiaires", "Nouvelle prise en charge", "Historique"]).map(
          (t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "primary-button" : "secondary-button"}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ),
        )}
      </div>
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
      {tab === "Nouvelle prise en charge" ? (
        <>
          <section className="grid gap-2">
            <h3 className="font-bold">1. Élève bénéficiaire</h3>
            <input
              aria-label="Rechercher un élève"
              className="input"
              value={studentQuery}
              placeholder="Nom, postnom, prénom, matricule ou classe"
              onChange={(e) => setStudentQuery(e.target.value)}
            />
            <select
              aria-label="Élève bénéficiaire"
              className="input"
              value={studentId}
              disabled={!!editing}
              onChange={(e) => {
                setStudentId(e.target.value);
                setValues({});
              }}
            >
              <option value="">Sélectionner un élève</option>
              {students
                .filter(
                  (s) =>
                    s.id === studentId ||
                    `${s.nom} ${s.postnom} ${s.prenom} ${s.matricule} ${s.className}`
                      .toLocaleLowerCase()
                      .includes(studentQuery.toLocaleLowerCase()),
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom} {s.postnom} {s.prenom} — {s.matricule} —{" "}
                    {s.className}
                  </option>
                ))}
            </select>
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
      {reason === "third-party" && (
              <p>
                Ces montants sont des engagements du tiers, sans réduction
                scolaire ni encaissement. « Exonération totale » signifie ici
                couverture totale par le tiers.
              </p>
            )}
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
            {reason === "third-party" && (
              <Field label="Nom du tiers responsable *">
                <input
                  className="input"
                  maxLength={160}
                  value={thirdPartyName}
                  onChange={(e) => setThirdPartyName(e.target.value)}
                />
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
                  {reason === "third-party"
                    ? "(engagement tiers)"
                    : "(réduction)"}
                </p>
                <p>
                  Engagements tiers : {money(p.balance.commitment+(reason==='third-party'?p.amount:0))} · Net exigible : {money(p.net)} · Encaissé :{" "}
                  {money(p.balance.paid)} · Solde : {money(p.remaining)}
                </p>
              </article>
            ))}
            <p>
              Total officiel : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.fee.amount),0)))} · Réductions antérieures : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.balance.reduction),0)))} · Nouvel avantage : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.amount),0)))} · Engagements tiers : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.balance.commitment)+(reason==='third-party'?toMoneyMinor(p.amount):0),0)))} · Encaissé : {money(fromMoneyMinor(preview.reduce((s,p)=>s+toMoneyMinor(p.balance.paid),0)))} · Total net :{" "}
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
              Modification tracée de {editing.id} (version {editing.version}).
            </p>
          )}
          <button
            className="primary-button"
            disabled={!valid}
            onClick={() =>
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
                  ? { decisionId: editing.id, expectedVersion: editing.version }
                  : {}),
              })
            }
          >
            {busy ? "Enregistrement…" : "Confirmer la prise en charge"}
          </button>
          <button className="secondary-button" disabled={busy} onClick={reset}>
            Réinitialiser le formulaire
          </button>
        </>
      ) : (
        <>
          <div className="flex min-w-0 gap-2">
            <input
              aria-label="Rechercher les décisions"
              className="input min-w-0 flex-1"
              placeholder="Élève, matricule, classe, frais ou motif"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="secondary-button shrink-0"
              disabled={loading || busy || !contextReady}
              onClick={() => void exportPdf()}
            >
              Exporter PDF
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {scopedSchools.length > 1 && <select aria-label="Établissement" className="input" value={filterSchool} onChange={(event) => setFilterSchool(event.target.value)}><option value="">Tous les établissements</option>{scopedSchools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            <select
              aria-label="Année scolaire"
              className="input"
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
              aria-label="Classe"
              className="input"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            >
              <option value="">Toutes les classes</option>
              {[...new Set(decisions.map((d) => d.className))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Frais"
              className="input"
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
              aria-label="Motif"
              className="input"
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
              aria-label="Statut"
              className="input"
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
                aria-label="Opération"
                className="input"
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
                    {formatCurrencyMoney(l.reductionMinor / 100, d.currency)} ·
                    engagement{" "}
                    {formatCurrencyMoney(l.commitmentMinor / 100, d.currency)}
                  </p>
                ))}
                <p>{decisionFinances(d)}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="secondary-button"
                    onClick={() => setDetail(d)}
                  >
                    Détails
                  </button>
                  {!readOnly && <button
                    className="secondary-button"
                    disabled={
                      busy ||
                      status(d) !== "Active" ||
                      d.schoolYearId !== year?.id
                    }
                    onClick={() => edit(d)}
                  >
                    Modifier
                  </button>}
                  {!readOnly && <button
                    className="secondary-button"
                    disabled={
                      busy ||
                      status(d) !== "Active" ||
                      d.schoolYearId !== year?.id
                    }
                    onClick={() => setCancelTarget(d)}
                  >
                    Annuler la décision
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
      {detail && (
        <section className="rounded border p-4">
          <h3 className="font-bold">Décision {detail.id}</h3>
          <p>
            {supportReasons[detail.reason]} · {natures[detail.nature]}
          </p>
          <p>{detail.thirdPartyName || detail.personnelId}</p>
          <p className="whitespace-pre-wrap">{detail.observation}</p>
          {Object.entries(detail.lines).map(([id, l]) => (
            <p key={id}>
              {id} : réduction {l.reductionMinor / 100}, engagement{" "}
              {l.commitmentMinor / 100}
            </p>
          ))}
          <button className="secondary-button" onClick={() => setDetail(null)}>
            Fermer les détails
          </button>
        </section>
      )}
      {!readOnly && cancelTarget && (
        <section
          role="alertdialog"
          aria-label="Confirmer l’annulation"
          className="rounded border p-4"
        >
          <p>
            Annuler la décision {cancelTarget.id} ? L’historique et les
            paiements seront conservés.
          </p>
          <button
            disabled={busy}
            className="primary-button"
            onClick={() =>
              void mutate({
                action: "cancel-social-support",
                decisionId: cancelTarget.id,
                expectedVersion: cancelTarget.version,
              })
            }
          >
            Confirmer l’annulation
          </button>
          <button
            disabled={busy}
            className="secondary-button"
            onClick={() => setCancelTarget(null)}
          >
            Retour
          </button>
        </section>
      )}
    </div>
  );
}
