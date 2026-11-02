import { createHash } from "node:crypto";
import { FinancialApiError } from "./financialTransactions.js";
import { supportAmount, supportBalance, supportReductionCeiling, supportCeilingMessage } from "./socialSupportMath.js";
import { toMoneyMinor, fromMoneyMinor } from "./money.js";

const reasons = [
  "social",
  "scholarship",
  "direction",
  "personnel",
  "third-party",
  "other",
];
const fail = (message, status = 400) => {
  throw new FinancialApiError(
    status,
    status === 403 ? "permission-denied" : "failed-precondition",
    message,
  );
};
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value)
    ? value
    : fail("Identifiant invalide.");
export async function manageSocialSupport({ db, caller, body }) {
  if (!["school_admin", "admin"].includes(caller.role) || !caller.schoolId)
    fail("Réservé à l’administrateur de l’établissement.", 403);
  const schoolId = id(caller.schoolId);
  if (body.action === "list-social-support") {
    const snapshot = await db
      .collection("socialSupportDecisions")
      .where("schoolId", "==", schoolId)
      .get();
    // Reconcile lifecycle against the official year on administrative consultation.
    // Expiry freezes decisions; historical reductions stay attached to their original year.
    const decisions = [];
    for (const document of snapshot.docs) {
      decisions.push(
        await db.runTransaction(async (tx) => {
          const current = await tx.get(
            db.doc(`socialSupportDecisions/${document.id}`),
          );
          const decision = current.data();
          if (!decision || decision.schoolId !== schoolId)
            fail("Décision inaccessible.", 403);
          if (decision.status !== "active") return decision;
          const ys = await tx.get(
            db.doc(`schoolYears/${decision.schoolYearId}`),
          );
          const year = ys.data();
          if (
            !year ||
            year.schoolId !== schoolId ||
            !year.endsAt ||
            !Number.isFinite(Date.parse(year.endsAt))
          )
            return decision;
          const expired =
            year.status === "archived" ||
            Date.parse(`${year.endsAt.slice(0, 10)}T23:59:59Z`) < Date.now();
          if (!expired && year.endsAt === decision.validUntil) return decision;
          const at = new Date().toISOString(),
            eventId = createHash("sha256")
              .update(`${document.id}:${decision.version}:lifecycle`)
              .digest("hex");
          const next = {
            ...decision,
            status: expired ? "expired" : "active",
            validUntil: year.endsAt,
            updatedAt: at,
            version: decision.version + 1,
          };
          const event = {
            id: eventId,
            action: expired ? "expire" : "validity-update",
            at,
            actorId: caller.uid,
            actorName: "Réconciliation de l’année scolaire",
            before: { ...decision, history: undefined },
            after: { ...next, history: undefined },
          };
          const safeEvent = JSON.parse(JSON.stringify(event));
          next.history = [...(decision.history ?? []), safeEvent];
          tx.set(db.doc(`socialSupportDecisions/${document.id}`), next);
          tx.set(db.doc(`socialSupportAudit/${eventId}`), {
            ...safeEvent,
            schoolId,
            schoolYearId: decision.schoolYearId,
            studentId: decision.studentId,
            decisionId: document.id,
          });
          return next;
        }),
      );
    }
    return { decisions };
  }
  const requestId = id(body.clientRequestId);
  if (requestId.length < 12) fail("Clé de requête invalide.");
  const hash = createHash("sha256")
    .update(`${schoolId}:${caller.uid}:${requestId}`)
    .digest("hex");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  return db.runTransaction(async (tx) => {
    const requestRef = db.doc(`socialSupportRequests/${hash}`);
    const request = await tx.get(requestRef);
    if (request.exists) {
      if (request.data().fingerprint !== fingerprint)
        fail("Requête déjà utilisée avec un contenu différent.", 409);
      return request.data().result;
    }
    const decisionId = body.decisionId
      ? id(body.decisionId)
      : `support_${hash.slice(0, 24)}`;
    const ref = db.doc(`socialSupportDecisions/${decisionId}`);
    const oldSnapshot = await tx.get(ref),
      old = oldSnapshot.exists ? oldSnapshot.data() : null;
    if (old && old.schoolId !== schoolId) fail("Décision inaccessible.", 403);
    if (body.decisionId && !old) fail("Décision introuvable.");
    if (
      old &&
      (body.expectedVersion !== old.version || old.status !== "active")
    )
      fail("La décision a changé. Actualisez.", 409);
    const studentId = id(old?.studentId ?? body.studentId),
      yearId = id(old?.schoolYearId ?? body.schoolYearId);
    const studentRef = db.doc(`students/${studentId}`);
    const [ss, ys, schoolSnap, actorSnap] = await Promise.all([
      tx.get(studentRef),
      tx.get(db.doc(`schoolYears/${yearId}`)),
      tx.get(db.doc(`schools/${schoolId}`)),
      tx.get(db.doc(`users/${caller.uid}`)),
    ]);
    const student = ss.data(),
      year = ys.data(),
      school = schoolSnap.data(),
      actor = actorSnap.data();
    if (
      !actor ||
      actor.schoolId !== schoolId ||
      !["admin", "school_admin"].includes(actor.role) ||
      actor.active === false ||
      actor.status === "inactive"
    )
      fail("Administrateur inactif.", 403);
    if (
      !school ||
      ["inactive", "suspended", "deleting"].includes(school.status)
    )
      fail("Établissement inactif.");
    if (
      !student ||
      student.schoolId !== schoolId ||
      student.schoolYearId !== yearId ||
      student.status !== "ACTIVE"
    )
      fail("Élève invalide.");
    if (
      !year ||
      year.schoolId !== schoolId ||
      year.status !== "active" ||
      school.activeSchoolYearId !== yearId
    )
      fail("Une année active est obligatoire.");
    if (
      !year.endsAt ||
      !Number.isFinite(Date.parse(year.endsAt)) ||
      Date.parse(`${year.endsAt.slice(0, 10)}T23:59:59Z`) < Date.now()
    )
      fail("Clôture officielle absente ou année clôturée.");
    const projection = { ...(student.financialSupport ?? {}) };
    delete projection[decisionId];
    const paymentsSnap = await tx.get(
      db.collection("payments").where("studentId", "==", studentId),
    );
    const payments = paymentsSnap.docs
      .map((d) => d.data())
      .filter((p) => p.schoolId === schoolId && p.schoolYearId === yearId);
    const cancelling = body.action === "cancel-social-support";
    if (cancelling && !old) fail("Décision introuvable.");
    if (!cancelling && body.action !== "save-social-support")
      fail("Action invalide.");
    let next;
    const feeLocks = [];
    if (cancelling) {
      if (payments.some((p) => p.supportDecisionId === decisionId))
        fail(
          "Cette prise en charge a des encaissements. Une correction financière contrôlée est nécessaire.",
        );
      next = { ...old, status: "cancelled" };
    } else {
      if (!reasons.includes(body.reason)) fail("Sélectionner un motif.");
      if (!["fixed", "percent", "full"].includes(body.nature))
        fail("Nature invalide.");
      if (
        !Array.isArray(body.lines) ||
        !body.lines.length ||
        body.lines.length > 50
      )
        fail("Sélectionner de 1 à 50 frais.");
      if (
        new Set(body.lines.map((l) => l.feeTypeId)).size !== body.lines.length
      )
        fail("Frais en double.");
      const personnelId =
        body.reason === "personnel" ? id(body.personnelId) : null;
      if (personnelId) {
        const snaps = await Promise.all([
          tx.get(db.doc(`users/${personnelId}`)),
          tx.get(db.doc(`personnelProfiles/${personnelId}`)),
        ]);
        if (
          !snaps.some(
            (s) =>
              s.exists &&
              s.data().schoolId === schoolId &&
              (s.data().kind === "service" ||
                [
                  "school_admin",
                  "cashier",
                  "secretary",
                  "teacher",
                  "study_director",
                  "discipline_director",
                ].includes(s.data().role) ||
                s.data().jobTitle),
          )
        )
          fail("Personnel invalide.");
      }
      const thirdPartyName =
        body.reason === "third-party" && typeof body.thirdPartyName === "string"
          ? body.thirdPartyName.trim()
          : "";
      if (
        body.reason === "third-party" &&
        (!thirdPartyName || thirdPartyName.length > 160)
      )
        fail("Nom du tiers obligatoire (160 caractères maximum).");
      if (
        typeof body.observation !== "string" ||
        body.observation.length > 2000
      )
        fail("Observation invalide.");
      const lines = {};
      for (const line of body.lines) {
        const feeId = id(line.feeTypeId),
          fs = await tx.get(db.doc(`feeTypes/${feeId}`)),
          fee = fs.data();
        const target =
          student.option && student.className.includes("Humanité")
            ? `${student.className}::option::${student.option.trim()}`
            : student.className;
        if (
          !fee ||
          fee.schoolId !== schoolId ||
          fee.schoolYearId !== yearId ||
          (fee.classOptionKey
            ? fee.classOptionKey !== target
            : fee.className && fee.className !== student.className)
        )
          fail("Frais non applicable à cet élève.");
        feeLocks.push(db.doc(`socialSupportFeeLocks/${feeId}`));
        const balance = supportBalance(
          { ...student, id: studentId, financialSupport: projection },
          { ...fee, id: feeId },
          payments,
        );
        // The percentage/full basis remains the eligible fee amount; the ceiling
        // additionally respects payments and any third-party share.
        const ceiling = supportReductionCeiling(balance);
        const basis = toMoneyMinor(body.reason === "third-party" ? balance.studentRemaining : Math.max(0, balance.net - balance.commitment));
        const currency = year.currency === "CDF" || year.currency === "USD" ? year.currency : school.currency === "CDF" ? "CDF" : "USD";
        const message = supportCeilingMessage(ceiling, currency);
        if (body.nature === "fixed" && typeof line.value === "number" && Number.isFinite(line.value) && line.value > fromMoneyMinor(ceiling)) fail(message, 409);
        let amount;
        try {
          amount = supportAmount(body.nature, line.value, basis);
        } catch (e) {
          if (body.nature === "fixed" && typeof line.value === "number" && line.value > fromMoneyMinor(ceiling)) fail(message, 409);
          fail(e.message);
        }
        if (amount > ceiling) fail(message, 409);
        lines[feeId] = {
          feeName: fee.name,
          officialMinor: toMoneyMinor(fee.amount),
          value: body.nature === "full" ? 100 : line.value,
          reductionMinor: body.reason === "third-party" ? 0 : amount,
          commitmentMinor: body.reason === "third-party" ? amount : 0,
        };
      }
      if (old && payments.some((p) => p.supportDecisionId === decisionId))
        fail(
          "Une décision avec encaissement tiers ne peut pas être réaffectée.",
        );
      next = {
        id: decisionId,
        schoolId,
        schoolYearId: yearId,
        studentId,
        studentName: [student.nom, student.postnom, student.prenom]
          .filter(Boolean)
          .join(" "),
        matricule: student.matricule ?? "",
        className: student.className,
        currency: year.currency ?? school.currency ?? "USD",
        reason: body.reason,
        nature: body.nature,
        personnelId,
        thirdPartyName,
        observation: body.observation.trim(),
        lines,
        status: "active",
        createdAt: old?.createdAt ?? new Date().toISOString(),
        createdBy: old?.createdBy ?? caller.uid,
      };
      projection[decisionId] = {
        id: decisionId,
        schoolYearId: yearId,
        lines,
      };
    }
    const now = new Date().toISOString();
    const event = {
      id: hash,
      action: cancelling ? "cancel" : old ? "update" : "create",
      at: now,
      actorId: caller.uid,
      actorName: actor.name ?? "",
      before: old ? { ...old, history: undefined } : null,
      after: { ...next, history: undefined },
    };
    // Explicit JSON boundary removes undefined from snapshots, never credentials.
    next = {
      ...next,
      version: (old?.version ?? 0) + 1,
      updatedAt: now,
      validUntil: year.endsAt,
      history: [...(old?.history ?? []), JSON.parse(JSON.stringify(event))],
    };
    if (next.history.length > 150)
      fail(
        "Limite de révisions atteinte. Une nouvelle décision est nécessaire.",
      );
    feeLocks.forEach((lock) =>
      tx.set(lock, { schoolId, schoolYearId: yearId, updatedAt: now }),
    );
    tx.set(ref, next);
    tx.update(studentRef, { financialSupport: projection });
    tx.set(db.doc(`socialSupportAudit/${hash}`), {
      ...JSON.parse(JSON.stringify(event)),
      schoolId,
      schoolYearId: yearId,
      studentId,
      decisionId,
    });
    const result = { decision: next };
    tx.set(requestRef, { fingerprint, result, schoolId });
    return result;
  });
}
