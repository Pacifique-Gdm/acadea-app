import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData } from "../types";

const calls = vi.hoisted(() => ({ setDoc: [] as Array<[string, unknown]>, updateDoc: [] as Array<[string, Record<string, unknown>]>, created: [] as string[], updateError: undefined as undefined | { code: string } }));
const DELETE = vi.hoisted(() => Symbol("deleteField"));
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(),
  doc: (_db: unknown, name: string, id: string) => `${name}/${id}`,
  setDoc: async (path: string, value: unknown) => { calls.setDoc.push([path, value]); },
}));
vi.mock("@firebase/firestore", () => ({
  doc: (_db: unknown, name: string, id: string) => `${name}/${id}`,
  setDoc: async (path: string, value: unknown) => { calls.setDoc.push([path, value]); },
  updateDoc: async (path: string, value: Record<string, unknown>) => { if (calls.updateError) throw calls.updateError; calls.updateDoc.push([path, value]); },
  deleteField: () => DELETE,
}));
vi.mock("./conditionalFirestoreWrite", () => ({ conditionalFirestoreWrite: async (name: string, id: string) => { calls.created.push(`${name}/${id}`); } }));
vi.mock("./superAdminData", () => ({ loadSuperAdminInitialData: vi.fn() }));

import { persistFirestorePatch } from "./firestoreData";
import { planCollectionWrites, previousWithConfirmedBase, rememberUnconfirmedBases, type PersistableRecord } from "../utils/persistencePlan";

const records = (rows: unknown) => rows as PersistableRecord[];

type Parent = AppData["parents"][number];
const parent = (id: string, overrides: Partial<Parent> = {}) => ({ id, schoolId: "school-a", fullName: `Parent ${id}`, phone: "0810000000", email: `${id}@example.invalid`, studentIds: [], ...overrides }) as Parent;
const before = [parent("p1"), parent("p2"), parent("p3")];
const writes = () => ({ full: calls.setDoc.map(([path]) => path), fields: calls.updateDoc, created: calls.created });

describe("écritures ciblées (updateData)", () => {
  beforeEach(() => { calls.setDoc = []; calls.updateDoc = []; calls.created = []; calls.updateError = undefined; });

  it("ancien comportement de référence : toute la collection est réécrite", async () => {
    await persistFirestorePatch({ parents: [before[0], { ...before[1], fullName: "Nouveau" }, before[2]] }, { throwOnError: true });
    expect(writes().full).toEqual(["parents/p1", "parents/p2", "parents/p3"]);
  });

  it("n'écrit que la fiche modifiée, et seulement le champ modifié", async () => {
    await persistFirestorePatch({ parents: [before[0], { ...before[1], fullName: "Nouveau" }, before[2]] }, { throwOnError: true, previous: { parents: before } });
    expect(writes()).toEqual({ full: [], fields: [["parents/p2", { fullName: "Nouveau" }]], created: [] });
  });

  it("préserve la modification simultanée d'un collègue sur un autre champ de la même fiche", async () => {
    // Le téléphone a été changé par un collègue côté serveur ; ici on ne modifie que le nom.
    await persistFirestorePatch({ parents: [{ ...before[0], fullName: "Nom corrigé" }] }, { throwOnError: true, previous: { parents: before } });
    expect(calls.updateDoc).toEqual([["parents/p1", { fullName: "Nom corrigé" }]]);
    expect(calls.setDoc).toEqual([]);
  });

  it("efface un champ retiré de la fiche", async () => {
    const withoutEmail: Record<string, unknown> = { ...before[0] };
    delete withoutEmail.email;
    await persistFirestorePatch({ parents: [withoutEmail as unknown as Parent] }, { throwOnError: true, previous: { parents: before } });
    expect(calls.updateDoc).toEqual([["parents/p1", { email: DELETE }]]);
  });

  it("crée une nouvelle fiche comme avant (création conditionnelle) et écrit entière une fiche inconnue", async () => {
    await persistFirestorePatch({ parents: [...before, parent("p4"), parent("p5")] }, { throwOnError: true, previous: { parents: before }, createIds: { parents: ["p4"] } });
    expect(writes()).toEqual({ full: ["parents/p5"], fields: [], created: ["parents/p4"] });
  });

  it("suppressions : exactement comme avant, aucune suppression n'est écrite et les autres fiches suivent leur règle", async () => {
    const remaining = [before[0], before[2]];
    await persistFirestorePatch({ parents: remaining }, { throwOnError: true });
    const legacy = writes().full;
    expect(legacy).toEqual(["parents/p1", "parents/p3"]); // avant : p2 n'est pas supprimé, les autres sont réécrites
    calls.setDoc = [];
    await persistFirestorePatch({ parents: remaining }, { throwOnError: true, previous: { parents: before } });
    expect(writes()).toEqual({ full: [], fields: [], created: [] }); // maintenant : p2 n'est toujours pas supprimé, rien d'inutile n'est écrit
    expect(planCollectionWrites(records(before), records(remaining)).map((write) => write.id)).not.toContain("p2");
  });

  it("écrit la fiche entière quand un nom de champ serait lu comme un chemin", async () => {
    await persistFirestorePatch({ parents: [{ ...before[0], "a.b": 1 } as unknown as Parent] }, { throwOnError: true, previous: { parents: before } });
    expect(writes().full).toEqual(["parents/p1"]);
    expect(calls.updateDoc).toEqual([]);
  });

  it("ne recrée jamais une fiche supprimée entre-temps par un collègue", async () => {
    calls.updateError = { code: "not-found" };
    await expect(persistFirestorePatch({ parents: [{ ...before[0], fullName: "X" }] }, { throwOnError: true, previous: { parents: before } })).rejects.toMatchObject({ code: "not-found" });
    expect(calls.setDoc).toEqual([]);
  });

  it("transmet tout autre refus (règles, réseau) sans écriture de secours", async () => {
    calls.updateError = { code: "permission-denied" };
    await expect(persistFirestorePatch({ parents: [{ ...before[0], fullName: "X" }] }, { throwOnError: true, previous: { parents: before } })).rejects.toMatchObject({ code: "permission-denied" });
    expect(calls.setDoc).toEqual([]);
  });

  it("compare les objets sans tenir compte de l'ordre des clés", () => {
    const reordered = { studentIds: [], email: "p1@example.invalid", phone: "0810000000", fullName: "Parent p1", schoolId: "school-a", id: "p1" };
    expect(planCollectionWrites(records([before[0]]), records([reordered]))).toEqual([]);
  });

  it("après un échec, le réessai n'écrit que les champs modifiés depuis la dernière version confirmée, jamais la fiche entière", async () => {
    const bases = new Map<string, PersistableRecord>();
    const firstAttempt = [{ ...before[0], fullName: "Nom corrigé" }, before[1], before[2]];
    rememberUnconfirmedBases(bases, { parents: before }, { parents: firstAttempt }); // le premier envoi a échoué
    const secondAttempt = [{ ...firstAttempt[0], phone: "0899999999" }, before[1], before[2]];
    const previous = previousWithConfirmedBase({ parents: firstAttempt } as unknown as AppData, { parents: secondAttempt } as unknown as Partial<AppData>, bases);
    await persistFirestorePatch({ parents: secondAttempt }, { throwOnError: true, previous });
    expect(calls.setDoc).toEqual([]);
    expect(calls.updateDoc).toEqual([["parents/p1", { fullName: "Nom corrigé", phone: "0899999999" }]]);
  });
});
