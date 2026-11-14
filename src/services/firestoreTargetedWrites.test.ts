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
import { planCollectionWrites, previousWithoutUnconfirmed } from "../utils/persistencePlan";

type Parent = AppData["parents"][number];
const parent = (id: string, overrides: Partial<Parent> = {}) => ({ id, schoolId: "school-a", name: `Parent ${id}`, phone: "0810000000", email: `${id}@example.invalid`, studentIds: [], ...overrides }) as Parent;
const before = [parent("p1"), parent("p2"), parent("p3")];
const writes = () => ({ full: calls.setDoc.map(([path]) => path), fields: calls.updateDoc, created: calls.created });

describe("écritures ciblées (updateData)", () => {
  beforeEach(() => { calls.setDoc = []; calls.updateDoc = []; calls.created = []; calls.updateError = undefined; });

  it("ancien comportement de référence : toute la collection est réécrite", async () => {
    await persistFirestorePatch({ parents: [before[0], { ...before[1], name: "Nouveau" }, before[2]] }, { throwOnError: true });
    expect(writes().full).toEqual(["parents/p1", "parents/p2", "parents/p3"]);
  });

  it("n'écrit que la fiche modifiée, et seulement le champ modifié", async () => {
    await persistFirestorePatch({ parents: [before[0], { ...before[1], name: "Nouveau" }, before[2]] }, { throwOnError: true, previous: { parents: before } });
    expect(writes()).toEqual({ full: [], fields: [["parents/p2", { name: "Nouveau" }]], created: [] });
  });

  it("préserve la modification simultanée d'un collègue sur un autre champ de la même fiche", async () => {
    // Le téléphone a été changé par un collègue côté serveur ; ici on ne modifie que le nom.
    await persistFirestorePatch({ parents: [{ ...before[0], name: "Nom corrigé" }] }, { throwOnError: true, previous: { parents: before } });
    expect(calls.updateDoc).toEqual([["parents/p1", { name: "Nom corrigé" }]]);
    expect(calls.setDoc).toEqual([]);
  });

  it("efface un champ retiré de la fiche", async () => {
    const { email: _email, ...withoutEmail } = before[0];
    await persistFirestorePatch({ parents: [withoutEmail as Parent] }, { throwOnError: true, previous: { parents: before } });
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
    expect(planCollectionWrites(before, remaining).map((write) => write.id)).not.toContain("p2");
  });

  it("écrit la fiche entière quand un nom de champ serait lu comme un chemin", async () => {
    await persistFirestorePatch({ parents: [{ ...before[0], "a.b": 1 } as Parent] }, { throwOnError: true, previous: { parents: before } });
    expect(writes().full).toEqual(["parents/p1"]);
    expect(calls.updateDoc).toEqual([]);
  });

  it("réécrit la fiche entière si elle n'existe plus côté serveur, comme avant", async () => {
    calls.updateError = { code: "not-found" };
    await persistFirestorePatch({ parents: [{ ...before[0], name: "X" }] }, { throwOnError: true, previous: { parents: before } });
    expect(writes().full).toEqual(["parents/p1"]);
  });

  it("transmet tout autre refus (règles, réseau) sans écriture de secours", async () => {
    calls.updateError = { code: "permission-denied" };
    await expect(persistFirestorePatch({ parents: [{ ...before[0], name: "X" }] }, { throwOnError: true, previous: { parents: before } })).rejects.toMatchObject({ code: "permission-denied" });
    expect(calls.setDoc).toEqual([]);
  });

  it("compare les objets sans tenir compte de l'ordre des clés", () => {
    const reordered = { studentIds: [], email: "p1@example.invalid", phone: "0810000000", name: "Parent p1", schoolId: "school-a", id: "p1" } as Parent;
    expect(planCollectionWrites([before[0]], [reordered])).toEqual([]);
  });

  it("après un échec, réécrit entières les fiches non confirmées à l'enregistrement suivant", () => {
    const previous = previousWithoutUnconfirmed({ parents: before, students: [] } as unknown as AppData, { parents: before }, new Set(["parents/p2"]));
    expect(planCollectionWrites(previous.parents, before).map((write) => [write.id, write.mode])).toEqual([["p2", "full"]]);
  });
});
