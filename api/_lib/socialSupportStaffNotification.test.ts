import { describe, expect, it } from "vitest";
import { manageSocialSupport, supportNotificationLabel } from "./socialSupport.js";

// Notification « Prise en charge enregistrée » au membre du personnel concerné.
// Base en mémoire recopiée de socialSupport.test.ts (une lecture après une écriture y fait échouer la transaction).
function fixture() {
  const values = new Map<string, Record<string, unknown>>([
    [
      "schools/s",
      { activeSchoolYearId: "y", status: "active", currency: "USD" },
    ],
    [
      "schoolYears/y",
      {
        schoolId: "s",
        status: "active",
        endsAt: "2099-06-30",
        currency: "USD",
      },
    ],
    ["users/a", { schoolId: "s", role: "school_admin", name: "Admin" }],
    ["users/c", { schoolId: "s", role: "cashier", name: "Caissier" }],
    ["users/sec", { schoolId: "s", role: "secretary", name: "Secrétaire" }],
    [
      "students/p",
      {
        id: "p",
        schoolId: "s",
        schoolYearId: "y",
        className: "1",
        status: "ACTIVE",
        nom: "Test",
        matricule: "A",
      },
    ],
    [
      "feeTypes/f",
      {
        id: "f",
        schoolId: "s",
        schoolYearId: "y",
        className: "1",
        name: "Minerval",
        amount: 300,
      },
    ],
    [
      "feeTypes/g",
      {
        id: "g",
        schoolId: "s",
        schoolYearId: "y",
        className: "1",
        name: "Examen",
        amount: 80,
      },
    ],
  ]);
  type Ref = { path?: string; name?: string; filters?: [string, unknown][] };
  const snapshot = (path: string) => ({
    id: path.split("/")[1],
    exists: values.has(path),
    data: () => values.get(path),
  });
  const query = (
    name: string,
    filters: [string, unknown][] = [],
  ): Ref & {
    get: () => Promise<{docs: ReturnType<typeof snapshot>[]}>;
    where: (
      key: string,
      op: string,
      value: unknown,
    ) => ReturnType<typeof query>;
  } => ({
    name,
    filters,
    get: async()=>({docs:[...values].filter(([path,value])=>path.startsWith(`${name}/`)&&filters.every(([key,wanted])=>value[key]===wanted)).map(([path])=>snapshot(path))}),
    where: (key, _op, value) => query(name, [...filters, [key, value]]),
  });
  const db = {
    doc: (path: string) => ({ path }),
    collection: (name: string) => query(name),
    runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      let writing = false;
      const result = await callback({
        get: async (ref: Ref) => {
          if (writing) throw Error("Read after write");
          return ref.path
            ? snapshot(ref.path)
            : {
                docs: [...values]
                  .filter(
                    ([path, value]) =>
                      path.startsWith(`${ref.name}/`) &&
                      ref.filters!.every(
                        ([key, wanted]) => value[key] === wanted,
                      ),
                  )
                  .map(([path]) => snapshot(path)),
              };
        },
        create: (ref: Ref, value: Record<string, unknown>) => {
          writing = true;
          if (values.has(ref.path!)) throw Error("Already exists");
          writes.push(() => {
            values.set(ref.path!, value);
          });
        },
        set: (ref: Ref, value: Record<string, unknown>) => {
          writing = true;
          writes.push(() => {
            values.set(ref.path!, value);
          });
        },
        update: (ref: Ref, value: Record<string, unknown>) => {
          writing = true;
          writes.push(() => {
            values.set(ref.path!, { ...values.get(ref.path!), ...value });
          });
        },
      });
      writes.forEach((write) => write());
      return result;
    },
  };
  const caller = { uid: "a", schoolId: "s", role: "school_admin" };
  const body = {
    action: "save-social-support",
    clientRequestId: "request-0000001",
    studentId: "p",
    schoolYearId: "y",
    nature: "fixed",
    reason: "social",
    observation: "",
    lines: [{ feeTypeId: "f", value: 100 }],
  };
  return { values, db, caller, body };
}
async function save(
  f: ReturnType<typeof fixture>,
  overrides: Record<string, unknown> = {},
) {
  return (await manageSocialSupport({
    db: f.db,
    caller: f.caller,
    body: { ...f.body, ...overrides },
  })) as {
    decision: {
      id: string;
      version: number;
      history: unknown[];
      lines: Record<
        string,
        { reductionMinor: number; commitmentMinor: number }
      >;
    };
  };
}

const notifications = (f: ReturnType<typeof fixture>) => [...f.values].filter(([path]) => path.startsWith("notifications/")).map(([, value]) => value);

describe("prise en charge « Personnel de l'école » : le membre du personnel est prévenu", () => {
  it("une décision pour un enseignant de l'école crée sa notification personnelle, sans montant", async () => {
    const f = fixture();
    f.values.set("users/staff", { schoolId: "s", role: "teacher", name: "Enseignant" });
    await save(f, { reason: "personnel", personnelId: "staff", nature: "percent", lines: [{ feeTypeId: "f", value: 50 }] });
    const all = notifications(f);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ recipientUserId: "staff", schoolId: "s", schoolYearId: "y", studentId: "p", type: "payment", module: "payments", event: "support_recorded", title: "Prise en charge enregistrée", read: false });
    expect(all[0]!.body).toBe("Élève : Test\nClasse : 1\nPrise en charge : la moitié");
    expect(String(all[0]!.body)).not.toMatch(/\d+[,.]\d{2}|USD|\$/);
    expect(all[0]).not.toHaveProperty("parentId");
    expect(all[0]).not.toHaveProperty("recipientRole");
  });

  it("aucune notification pour un autre motif, une personne sans compte dans l'école, ou une annulation", async () => {
    const social = fixture();
    await save(social);
    expect(notifications(social)).toHaveLength(0);

    const service = fixture();
    service.values.set("personnelProfiles/service", { schoolId: "s", kind: "service", name: "Service", jobTitle: "Entretien" });
    await save(service, { reason: "personnel", personnelId: "service" });
    expect(notifications(service)).toHaveLength(0);

    const cancel = fixture();
    cancel.values.set("users/staff", { schoolId: "s", role: "teacher" });
    const saved = await save(cancel, { reason: "personnel", personnelId: "staff" });
    await manageSocialSupport({ db: cancel.db, caller: cancel.caller, body: { action: "cancel-social-support", clientRequestId: "request-cancel-01", decisionId: saved.decision.id, schoolYearId: "y", studentId: "p" } }).catch(() => undefined);
    expect(notifications(cancel)).toHaveLength(1);
  });

  it("le libellé dit ce que l'enfant paie, sans montant", () => {
    expect(supportNotificationLabel({ nature: "full", lines: {} })).toBe("Prise en charge : rien à payer");
    expect(supportNotificationLabel({ nature: "percent", lines: { a: { value: 50 } } })).toBe("Prise en charge : la moitié");
    expect(supportNotificationLabel({ nature: "percent", lines: { a: { value: 100 } } })).toBe("Prise en charge : rien à payer");
    expect(supportNotificationLabel({ nature: "fixed", lines: { a: { value: 20 } } })).toBe("Prise en charge : réduction accordée");
  });
});
