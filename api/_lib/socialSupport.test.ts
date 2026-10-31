import { describe, expect, it } from "vitest";
import { executeFinancialOperation } from "./financialTransactions.js";
import { manageSocialSupport } from "./socialSupport.js";
import { supportAmount, supportBalance, supportReductionCeiling, supportCeilingMessage } from "./socialSupportMath.js";
import type { FeeType, Payment, Student } from "../../src/types";

describe("montants exacts des prises en charge", () => {
  for (const value of [0, 100, 300])
    it(`accepte le fixe ${value}`, () =>
      expect(supportAmount("fixed", value, 30000)).toBe(value * 100));
  for (const value of [-1, 301, NaN, 1.001, "10"])
    it(`refuse le fixe ${value}`, () =>
      expect(() => supportAmount("fixed", value as number, 30000)).toThrow());
  for (const value of [0, 25, 50, 100])
    it(`accepte ${value}%`, () =>
      expect(supportAmount("percent", value, 30000)).toBe(value * 300));
  for (const value of [-1, 101, 12.5, 33.3, NaN])
    it(`refuse le pourcentage ${value}`, () =>
      expect(() => supportAmount("percent", value, 30000)).toThrow());
  it("arrondit les centimes et applique le pourcentage au reliquat", () => {
    expect(supportAmount("percent", 25, 20000)).toBe(5000);
    expect(supportAmount("percent", 50, 1)).toBe(1);
  });
  it("exonère seulement le plafond restant", () =>
    expect(supportAmount("full", 0, 20000)).toBe(20000));
});

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

describe("décisions financières atomiques", () => {
  it("réduit le net partagé sans créer de paiement ni changer le catalogue", async () => {
    const f = fixture();
    await save(f);
    const student = f.values.get("students/p") as unknown as Student,
      fee = f.values.get("feeTypes/f") as unknown as FeeType;
    expect(supportBalance(student, fee)).toMatchObject({
      official: 300,
      reduction: 100,
      net: 200,
      paid: 0,
      remaining: 200,
    });
    expect(
      supportBalance(student, f.values.get("feeTypes/g") as unknown as FeeType)
        .net,
    ).toBe(80);
    expect(
      [...f.values.keys()].filter((k) => k.startsWith("payments/")),
    ).toHaveLength(0);
    expect(f.values.get("feeTypes/f")?.amount).toBe(300);
  });
  it("applique des montants distincts par frais et conserve les encaissements", async () => {
    const f = fixture();
    f.values.set("payments/pay", {
      id: "pay",
      studentId: "p",
      schoolId: "s",
      schoolYearId: "y",
      feeTypeId: "f",
      amount: 50,
    });
    const original = JSON.stringify(f.values.get("payments/pay"));
    await save(f, {
      lines: [
        { feeTypeId: "f", value: 100 },
        { feeTypeId: "g", value: 40 },
      ],
    });
    const student = f.values.get("students/p") as unknown as Student;
    expect(
      supportBalance(
        student,
        f.values.get("feeTypes/f") as unknown as FeeType,
        [f.values.get("payments/pay") as unknown as Payment],
      ).remaining,
    ).toBe(150);
    expect(
      supportBalance(student, f.values.get("feeTypes/g") as unknown as FeeType)
        .net,
    ).toBe(40);
    expect(JSON.stringify(f.values.get("payments/pay"))).toBe(original);
  });
  it("distingue promesse, recette et débiteurs sans doubler la créance", async () => {
    const f = fixture(),
      { decision } = await save(f, {
        reason: "third-party",
        thirdPartyName: "Association",
      });
    const student = f.values.get("students/p") as unknown as Student,
      fee = f.values.get("feeTypes/f") as unknown as FeeType;
    expect(supportBalance(student, fee)).toMatchObject({
      net: 300,
      paid: 0,
      commitment: 100,
      studentRemaining: 200,
      thirdRemaining: 100,
    });
    const payment = {
      studentId: "p",
      schoolYearId: "y",
      feeTypeId: "f",
      amount: 30,
      supportDecisionId: decision.id,
    } as Payment;
    expect(supportBalance(student, fee, [payment])).toMatchObject({
      remaining: 270,
      studentRemaining: 200,
      thirdRemaining: 70,
      thirdPaid: 30,
    });
  });
  it("refuse les doubles réductions excessives et les requêtes divergentes", async () => {
    const f = fixture();
    await save(f);
    await expect(
      save(f, {
        clientRequestId: "request-0000002",
        lines: [{ feeTypeId: "f", value: 250 }],
      }),
    ).rejects.toThrow();
    await expect(
      save(f, { lines: [{ feeTypeId: "f", value: 90 }] }),
    ).rejects.toThrow();
  });
  it("rejoue une requête sans doubler la décision et conserve les versions", async () => {
    const f = fixture();
    const first = await save(f),
      again = await save(f);
    expect(again).toEqual(first);
    const updated = await save(f, {
      clientRequestId: "request-0000002",
      decisionId: first.decision.id,
      expectedVersion: 1,
      lines: [{ feeTypeId: "f", value: 150 }],
    });
    expect(updated.decision.version).toBe(2);
    expect(updated.decision.history).toHaveLength(2);
    await expect(
      save(f, {
        clientRequestId: "request-0000003",
        decisionId: first.decision.id,
        expectedVersion: 1,
      }),
    ).rejects.toThrow("changé");
  });
  it("annule sans effacer et restaure le net", async () => {
    const f = fixture(),
      first = await save(f);
    await save(f, {
      action: "cancel-social-support",
      clientRequestId: "request-0000002",
      decisionId: first.decision.id,
      expectedVersion: 1,
    });
    expect(
      f.values.get(`socialSupportDecisions/${first.decision.id}`)?.status,
    ).toBe("cancelled");
    expect(
      supportBalance(
        f.values.get("students/p") as unknown as Student,
        f.values.get("feeTypes/f") as unknown as FeeType,
      ).net,
    ).toBe(300);
  });
  for (const changes of [
    { reason: "" },
    { reason: "personnel" },
    { reason: "third-party" },
    { lines: [] },
    {
      lines: [
        { feeTypeId: "f", value: 1 },
        { feeTypeId: "f", value: 2 },
      ],
    },
  ])
    it(`refuse un formulaire incomplet ${JSON.stringify(changes)}`, async () => {
      const f = fixture();
      await expect(save(f, changes)).rejects.toThrow();
      expect(f.values.get("students/p")?.financialSupport).toBeUndefined();
    });
  for (const [path, patch] of [
    ["students/p", { schoolId: "other" }],
    ["feeTypes/f", { schoolId: "other" }],
    ["feeTypes/f", { className: "other" }],
    ["schoolYears/y", { endsAt: "" }],
    ["schoolYears/y", { status: "archived" }],
    ["schoolYears/y", { endsAt: "2000-01-01" }],
  ] as const)
    it(`bloque le contexte invalide ${path} ${JSON.stringify(patch)}`, async () => {
      const f = fixture();
      f.values.set(path, { ...f.values.get(path), ...patch });
      await expect(save(f)).rejects.toThrow();
    });
  it("refuse le caissier avant toute lecture", async () => {
    const f = fixture();
    await expect(
      manageSocialSupport({
        db: {},
        caller: { ...f.caller, role: "cashier" },
        body: f.body,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("bloque le trop-perçu sans altérer le reçu", async () => {
    const f = fixture();
    f.values.set("payments/pay", {
      studentId: "p",
      schoolYearId: "y",
      schoolId: "s",
      feeTypeId: "f",
      amount: 250,
    });
    await expect(save(f)).rejects.toThrow("Réduction non autorisée");
    expect(f.values.get("payments/pay")?.amount).toBe(250);
  });
});

describe("encaissement par le service financier existant", () => {
  it("encaisse un paiement tiers partiel, produit un reçu et refuse de dépasser la créance", async () => {
    const f = fixture();
    const { decision } = await save(f, {
      reason: "third-party",
      thirdPartyName: "Organisme local",
    });
    const body = {
      action: "create-payment",
      schoolYearId: "y",
      studentId: "p",
      feeTypeId: "f",
      amount: 30,
      supportDecisionId: decision.id,
      clientRequestId: "payment-request-001",
    };
    const result = (await executeFinancialOperation({
      db: f.db,
      caller: { uid: "c", schoolId: "s", role: "cashier" },
      body,
    })) as { payment: { amount: number; receiptNumber: string } };
    expect(result.payment.amount).toBe(30);
    expect(result.payment.receiptNumber).toMatch(/^REC-/);
    const payments = [...f.values]
      .filter(([key]) => key.startsWith("payments/"))
      .map(([, value]) => value as unknown as Payment);
    expect(
      supportBalance(
        f.values.get("students/p") as unknown as Student,
        f.values.get("feeTypes/f") as unknown as FeeType,
        payments,
      ),
    ).toMatchObject({
      paid: 30,
      thirdRemaining: 70,
      studentRemaining: 200,
      remaining: 270,
    });
    await expect(
      executeFinancialOperation({
        db: f.db,
        caller: { uid: "c", schoolId: "s", role: "cashier" },
        body: { ...body, amount: 71, clientRequestId: "payment-request-002" },
      }),
    ).rejects.toThrow("dépasse");
    await expect(
      save(f, {
        action: "cancel-social-support",
        decisionId: decision.id,
        expectedVersion: 1,
        clientRequestId: "request-cancel-001",
      }),
    ).rejects.toThrow("encaissements");
  });
  it("refuse de facturer la part promise au tiers comme une seconde dette élève", async () => {
    const f = fixture();
    await save(f, { reason: "third-party", thirdPartyName: "Organisme local" });
    await expect(
      executeFinancialOperation({
        db: f.db,
        caller: { uid: "c", schoolId: "s", role: "cashier" },
        body: {
          action: "create-payment",
          schoolYearId: "y",
          studentId: "p",
          feeTypeId: "f",
          amount: 201,
          clientRequestId: "payment-request-001",
        },
      }),
    ).rejects.toThrow("dépasse");
  });
  it("applique la réduction dans le contrôle serveur des paiements", async () => {
    const f = fixture();
    await save(f);
    await expect(
      executeFinancialOperation({
        db: f.db,
        caller: { uid: "c", schoolId: "s", role: "cashier" },
        body: {
          action: "create-payment",
          schoolYearId: "y",
          studentId: "p",
          feeTypeId: "f",
          amount: 201,
          clientRequestId: "payment-request-001",
        },
      }),
    ).rejects.toThrow("dépasse");
  });
});

describe('cycle de vie annuel',()=>{
 it('trace l’expiration sans supprimer les réductions historiques ni les reconduire',async()=>{
  const f=fixture();const {decision}=await save(f);
  f.values.set('schoolYears/y',{...f.values.get('schoolYears/y'),status:'archived'});
  await manageSocialSupport({db:f.db,caller:f.caller,body:{action:'list-social-support'}});
  const stored=f.values.get(`socialSupportDecisions/${decision.id}`)!;
  expect(stored.status).toBe('expired');expect((stored.history as {action:string}[]).at(-1)?.action).toBe('expire');
  const pupil=f.values.get('students/p') as unknown as Student,fee=f.values.get('feeTypes/f') as unknown as FeeType;
  expect(supportBalance(pupil,fee).net).toBe(200);
  expect(supportBalance({...pupil,schoolYearId:'new-year'},{...fee,schoolYearId:'new-year'}).net).toBe(300);
 });
 it('trace un changement officiel de clôture',async()=>{
  const f=fixture();const {decision}=await save(f);f.values.set('schoolYears/y',{...f.values.get('schoolYears/y'),endsAt:'2099-07-01'});
  await manageSocialSupport({db:f.db,caller:f.caller,body:{action:'list-social-support'}});
  const stored=f.values.get(`socialSupportDecisions/${decision.id}`)!;expect(stored.validUntil).toBe('2099-07-01');expect((stored.history as {action:string}[]).at(-1)?.action).toBe('validity-update');
 });
 it('vérifie le personnel dans le même établissement',async()=>{
  const f=fixture();f.values.set('users/staff',{schoolId:'other',role:'teacher'});
  await expect(save(f,{reason:'personnel',personnelId:'staff'})).rejects.toThrow('Personnel invalide');
  f.values.set('users/staff',{schoolId:'s',role:'teacher'});
  await expect(save(f,{reason:'personnel',personnelId:'staff'})).resolves.toHaveProperty('decision');
 });
});

describe('plafond automatique précis',()=>{
 it('montre le plafond après réductions et paiements',async()=>{
  const f=fixture();f.values.set('payments/pay',{schoolId:'s',schoolYearId:'y',studentId:'p',feeTypeId:'f',amount:50});await save(f);
  const b=supportBalance(f.values.get('students/p') as unknown as Student,f.values.get('feeTypes/f') as unknown as FeeType,[f.values.get('payments/pay') as unknown as Payment]);
  expect(b).toMatchObject({official:300,reduction:100,net:200,paid:50,remaining:150});
  expect(supportReductionCeiling(b)).toBe(15000);
  expect(supportCeilingMessage(15000,'USD')).toBe('Réduction non autorisée. Le montant demandé dépasse le plafond applicable à ce frais. Le montant maximal pouvant être accordé est de 150.00 USD, compte tenu des réductions et des paiements déjà enregistrés. Veuillez ajuster le montant pour poursuivre.');
  await expect(save(f,{clientRequestId:'request-0000002',lines:[{feeTypeId:'f',value:151}]})).rejects.toThrow('150.00 USD');
  await expect(save(f,{clientRequestId:'request-0000003',nature:'percent',lines:[{feeTypeId:'f',value:100}]})).rejects.toThrow('150.00 USD');
  await expect(save(f,{clientRequestId:'request-0000004',nature:'full',lines:[{feeTypeId:'f',value:100}]})).rejects.toThrow('150.00 USD');
  await expect(save(f,{clientRequestId:'request-0000005',lines:[{feeTypeId:'f',value:150}]})).resolves.toHaveProperty('decision');
 });
});

describe("répercussion automatique dans le calcul financier commun", () => {
  it("recalcule la créance affichée après chaque décision et chaque encaissement", async () => {
    const f = fixture();
    const fee = f.values.get("feeTypes/f") as unknown as FeeType;
    const original = () => supportBalance(f.values.get("students/p") as unknown as Student, fee,
      [...f.values].filter(([key]) => key.startsWith("payments/")).map(([,value]) => value as unknown as Payment));
    expect(original()).toMatchObject({official:300,reduction:0,paid:0,net:300,remaining:300});
    await save(f, {lines:[{feeTypeId:'f',value:100}]});
    expect(original()).toMatchObject({official:300,reduction:100,paid:0,net:200,remaining:200});
    f.values.set('payments/receipt',{id:'receipt',schoolId:'s',schoolYearId:'y',studentId:'p',feeTypeId:'f',amount:75,receiptNumber:'REC-2098-0001'});
    expect(original()).toMatchObject({official:300,reduction:100,paid:75,net:200,remaining:125});
    expect(supportReductionCeiling(original())).toBe(12500);
    await save(f,{clientRequestId:'request-0000006',lines:[{feeTypeId:'f',value:125}]});
    expect(original()).toMatchObject({official:300,reduction:225,paid:75,net:75,remaining:0,credit:0});
    expect(f.values.get('feeTypes/f')?.amount).toBe(300);
    expect(f.values.get('payments/receipt')?.amount).toBe(75);
  });
});

it('ne place aucun motif, observation ou nom du tiers dans la projection financière visible au Caissier',async()=>{
 const f=fixture();await save(f,{reason:'third-party',thirdPartyName:'Organisme privé',observation:'Situation sociale confidentielle'});
 const projection=JSON.stringify(f.values.get('students/p')?.financialSupport);
 expect(projection).not.toContain('Situation sociale confidentielle');
 expect(projection).not.toContain('Organisme privé');
 expect(projection).not.toContain('third-party');
});
