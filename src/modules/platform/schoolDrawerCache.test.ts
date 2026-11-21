import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { counterAsksReload, mergeSchoolHistory, needsSchoolDrawerLoad, schoolClassEnrollment, schoolDrawerKey, type SchoolDrawerCache } from "./schoolDrawerCache";
import type { AuditLog, School } from "../../types";

// Version 1.16.5 : données du drawer d'une école gardées en mémoire pendant la session.
const platform = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
const loader = platform.slice(platform.indexOf("function loadSchoolDrawerData("), platform.indexOf("function openSchoolDrawer("));

const emptyData = () => ({ data: { summary: { students: 0, parents: 0, admins: 0, users: 0, classes: [] }, history: { logs: [], page: 0, total: 0, hasMore: false } } });

describe("drawer d'une école gardé en mémoire", () => {
  it("retour sur une école déjà ouverte : aucune lecture, sauf avec « Actualiser »", () => {
    const cache: SchoolDrawerCache = new Map();
    const key = schoolDrawerKey("ecole-a", "annee-1");
    expect(needsSchoolDrawerLoad(cache, key)).toBe(true);
    cache.set(key, { ...emptyData(), counter: 3 });
    expect(needsSchoolDrawerLoad(cache, key)).toBe(false);
    expect(needsSchoolDrawerLoad(cache, key, true)).toBe(true);
    expect(needsSchoolDrawerLoad(cache, schoolDrawerKey("ecole-a", "annee-2"))).toBe(true);
  });

  it("relit seulement quand le compteur de changements de l'école a bougé", () => {
    const entry = { ...emptyData(), counter: undefined as number | undefined };
    expect(counterAsksReload(entry, 5)).toBe(false); // premier relevé : seulement noté
    expect(entry.counter).toBe(5);
    expect(counterAsksReload(entry, 5)).toBe(false);
    expect(counterAsksReload(entry, 6)).toBe(true);
    expect(counterAsksReload(undefined, 6)).toBe(false); // pas encore de données gardées
  });

  it("lot SA-4 : répartition par classe venant du serveur, dans l'ordre des classes et avec le nom d'option de l'école", () => {
    const school = { id: "a", schoolOptionDisplayNames: { Scientifique: "Sciences" } } as unknown as School;
    const rows = schoolClassEnrollment({ students: 4, parents: 1, admins: 1, users: 2, classes: [
      { className: "4ème Humanité", option: "Scientifique", count: 2 },
      { className: "1ère Primaire", option: "", count: 1 },
    ] }, school);
    expect(rows.map((row) => [row.label, row.count])).toEqual([["1ère Primaire", 1], ["4ème Sciences", 2]]);
    expect(schoolClassEnrollment(undefined, school)).toEqual([]);
  });

  it("lot SA-4 : historique = pages du serveur + lignes écrites pendant la session, sans doublon ni connexion", () => {
    const local = [
      { id: "l2", schoolId: "a", schoolYearId: "y1", action: "Suspension de l'ecole", actorName: "SA", createdAt: "2026-11-21T10:00:00.000Z" },
      { id: "l1", schoolId: "a", schoolYearId: "y1", action: "doublon", actorName: "SA", createdAt: "2026-11-20T10:00:00.000Z" },
      { id: "x", schoolId: "b", action: "Autre école", actorName: "SA", createdAt: "2026-11-21T11:00:00.000Z" },
      { id: "c", schoolId: "a", action: "Connexion", actorName: "SA", createdAt: "2026-11-21T12:00:00.000Z" },
    ] as AuditLog[];
    const server = [{ id: "l1", action: "Création", actorName: "SA", createdAt: "2026-11-20T10:00:00.000Z" }];
    const rows = mergeSchoolHistory(local, server, "a", "y1");
    expect(rows.map((row) => row.id)).toEqual(["l2", "l1"]);
    expect(rows[1].action).toBe("Création");
  });

  it("le drawer utilise la mémoire avant de lire le serveur, et a un bouton « Actualiser »", () => {
    expect(loader).toContain("if (cached && !needsSchoolDrawerLoad(schoolDrawerCache.current, key, options.force)) {");
    expect(loader.indexOf("needsSchoolDrawerLoad")).toBeLessThan(loader.indexOf("loadSchoolDrawerDetail(schoolId, schoolYearId)"));
    expect(loader.indexOf("needsSchoolDrawerLoad")).toBeLessThan(loader.indexOf("void refreshSchoolQuota(schoolId, requestId);"));
    expect(platform).toContain("useSchoolChangeCounter(drawerKey,");
    expect(platform).toContain("onClick={refreshSchoolDrawer}");
  });
});
