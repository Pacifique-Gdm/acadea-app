import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (base: { name: string }, ...constraints: unknown[]) => ({ base: base.name, constraints }),
  onSnapshot: vi.fn(),
}));
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));

import { computeValveAudience as computeValveAudienceTyped } from "./valveAudience.js";
const computeValveAudience = computeValveAudienceTyped as (...args: unknown[]) => ReturnType<typeof computeValveAudienceTyped>;
import { valveQueries } from "../hooks/useRealtimeValves";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Valves : public enregistré avec chaque publication", () => {
  const parents = [{ id: "pa", studentIds: ["ea"] }, { id: "pb", studentIds: ["eb"] }];
  const students = [
    { id: "ea", parentId: "pa", className: "1ère Primaire", schoolId: "s1", schoolYearId: "y1", status: "ACTIVE" as const },
    { id: "eb", parentId: "pb", className: "2ème Humanité", option: "Scientifique", schoolId: "s1", schoolYearId: "y1", status: "ACTIVE" as const },
  ];
  const scope = { schoolId: "s1", schoolYearId: "y1" };

  it("« Tous les parents », section, classe, classe avec option", () => {
    expect(computeValveAudience({ ...scope, visibility: "all_parents" }, parents, students)).toEqual({ audienceAll: true, audienceParentIds: [] });
    expect(computeValveAudience({ ...scope, visibility: "Primaire" }, parents, students)).toEqual({ audienceAll: false, audienceParentIds: ["pa"] });
    expect(computeValveAudience({ ...scope, visibility: "Secondaire" }, parents, students)).toEqual({ audienceAll: false, audienceParentIds: ["pb"] });
    expect(computeValveAudience({ ...scope, visibility: "class", targetClassKey: "2ème Humanité::option::Scientifique" }, parents, students)).toEqual({ audienceAll: false, audienceParentIds: ["pb"] });
    expect(computeValveAudience({ ...scope, visibility: "class", targetClassKey: "2ème Humanité" }, parents, students)).toEqual({ audienceAll: false, audienceParentIds: [] });
  });

  it("une autre année ou une autre école ne compte pas", () => {
    expect(computeValveAudience({ schoolId: "s1", schoolYearId: "y2", visibility: "Primaire" }, parents, students).audienceParentIds).toEqual([]);
    expect(computeValveAudience({ schoolId: "s2", schoolYearId: "y1", visibility: "Primaire" }, parents, students).audienceParentIds).toEqual([]);
  });

  it("bouton « Mettre à jour le public » : recalcule la liste avec la même fonction et l'enregistre", () => {
    const form = read("../components/valves/ValvesDrawerContent.tsx");
    expect(form).toContain('title="Mettre à jour le public"');
    const action = form.slice(form.indexOf("async function refreshPublicationAudience"), form.indexOf("function editPublication"));
    expect(action).toContain("computeValveAudience(publication, yearData.parents, yearData.students)");
    expect(action).toContain("persistFirestorePatch({ valves: [{ ...publication, ...audience");
  });

  it("le formulaire Valves enregistre le public avec la publication", () => {
    const form = read("../components/valves/ValvesDrawerContent.tsx");
    expect(form).toContain("...computeValveAudience({ visibility, targetClassKey: visibility === \"class\" ? targetClassKey : undefined, schoolId: school.id, schoolYearId: year.id }, yearData.parents, yearData.students)");
  });
});

describe("Valves : le parent n'interroge que ce que les règles lui permettent", () => {
  it("écoute en temps réel : « Tous » + sa liste ; jamais toute l'école", () => {
    const parentQueries = valveQueries({} as never, { role: "parent", parentId: "pa" }, "s1", "y1") as unknown as Array<{ constraints: Array<{ field: string; op: string; value: unknown }> }>;
    expect(parentQueries.map((item) => item.constraints.at(-1))).toEqual([
      { field: "audienceAll", op: "==", value: true },
      { field: "audienceParentIds", op: "array-contains", value: "pa" },
    ]);
    expect(valveQueries({} as never, { role: "parent" }, "s1", "y1")).toEqual([]);
    expect(valveQueries({} as never, { role: "school_admin" }, "s1", "y1")).toHaveLength(1);
  });

  it("premiers chargements du parent : les trois passent par loadParentValves", () => {
    const source = read("../services/firestoreData.ts");
    expect(source.match(/loadParentValves\(/g)?.length).toBe(4); // définition + 3 usages
    expect(source).not.toContain('valves: await loadCollection<AppData["valves"][number]>("valves", schoolFilter)');
  });
});
