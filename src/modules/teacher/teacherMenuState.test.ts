import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { teacherMenuProfileState } from "./teacherMenuState";

describe("lot 26b : Menu Enseignant toujours visible", () => {
  it("le Menu ne dépend plus du chargement ni du profil pédagogique", () => {
    const source = readFileSync(new URL("./TeacherPortal.tsx", import.meta.url), "utf8");
    expect(source).toContain('{activeTab === "menu" && <section');
    expect(source).not.toContain('!data.loading && data.teacher && activeTab === "menu"');
  });
  it("les boutons liés au profil attendent, avec un message clair", () => {
    expect(teacherMenuProfileState({ loading: true, error: "" })).toEqual({ ready: false, message: "Chargement de votre profil pédagogique…" });
    expect(teacherMenuProfileState({ loading: false, error: "Aucun profil pédagogique n’est lié à ce compte Enseignant." }).ready).toBe(false);
    expect(teacherMenuProfileState({ loading: false, error: "", teacher: { id: "t" } })).toEqual({ ready: true, message: "" });
  });
});
