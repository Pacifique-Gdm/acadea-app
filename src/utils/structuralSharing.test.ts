import { describe, expect, it, vi } from "vitest";
import { lastResult, reuseShallow, reuseUnchanged } from "./structuralSharing";
import { persistentMemo, clearPersistentMemo } from "../hooks/usePersistentMemo";

describe("données stables entre deux rendus", () => {
  const a = { id: "a" }, b = { id: "b" };

  it("rend l'objet précédent quand tous les tableaux ont le même contenu", () => {
    const previous = { students: [a, b], payments: [] as unknown[] };
    expect(reuseUnchanged({ students: [a, b], payments: [] }, previous)).toBe(previous);
  });

  it("réutilise seulement les tableaux inchangés quand un autre tableau change", () => {
    const previous = { students: [a], payments: [a] };
    const next = reuseUnchanged({ students: [a], payments: [a, b] }, previous);
    expect(next).not.toBe(previous);
    expect(next.students).toBe(previous.students);
    expect(next.payments).toEqual([a, b]);
  });

  it("ne réutilise jamais un tableau dont un élément a changé", () => {
    const previous = { students: [a, b] };
    const changed = { ...b, id: "b2" };
    expect(reuseUnchanged({ students: [a, changed] }, previous).students[1]).toBe(changed);
  });

  it("garde l'école courante tant que ses champs sont identiques", () => {
    const previous = { id: "s", currency: "USD" };
    expect(reuseShallow({ id: "s", currency: "USD" }, previous)).toBe(previous);
    expect(reuseShallow({ id: "s", currency: "CDF" }, previous)).not.toBe(previous);
  });

  it("garde le dernier résultat d'une fonction pure tant que ses arguments sont identiques", () => {
    const compute = vi.fn((items: unknown[]) => items.length);
    const cached = lastResult(compute);
    const list = [a];
    cached(list); cached(list);
    expect(compute).toHaveBeenCalledTimes(1);
    cached([a]);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("mémoire persistante : même résultat après démontage, recalcul si une dépendance change", () => {
    clearPersistentMemo();
    const factory = vi.fn(() => ({ total: 1 }));
    const list = [a];
    const first = persistentMemo("test.total", factory, [list, "all"]);
    expect(persistentMemo("test.total", factory, [list, "all"])).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
    persistentMemo("test.total", factory, [list, "Primaire"]);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("App : données et écoutes stables", () => {
  it("transmet des données réutilisées et garde l'écoute globale des élèves sur l'onglet Élèves", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(source).toContain("reuseUnchanged(scopeData(data, currentSchool.id, currentYear.id, user), lastYearData)");
    expect(source).toContain("includeStudents: true,");
    expect(source).not.toContain('activeTab !== "students" || route.startsWith("/admin/eleves/")');
  });
});
