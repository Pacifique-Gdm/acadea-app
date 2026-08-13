import { describe, expect, it } from "vitest";
import type { AppUser } from "../types";
import { mergeRealtimeUserProfile } from "./auth";

const connected: AppUser = {
  id: "director-1",
  name: "Direction",
  email: "direction@example.test",
  role: "study_director",
  schoolId: "school-1",
  section: "Primaire",
  sectionIds: ["Primaire"],
};

describe("profil utilisateur Firestore temps réel", () => {
  it("propage immédiatement ajout puis retrait de sections sans altérer l’identité sécurisée", () => {
    const expanded = mergeRealtimeUserProfile(connected, { section: "Primaire", sectionIds: ["Primaire", "Secondaire"] });
    expect(expanded).toMatchObject({ id: "director-1", role: "study_director", schoolId: "school-1", sectionIds: ["Primaire", "Secondaire"] });
    const reduced = mergeRealtimeUserProfile(expanded, { section: "Secondaire", sectionIds: ["Secondaire"] });
    expect(reduced.sectionIds).toEqual(["Secondaire"]);
  });

  it("normalise les valeurs CTEB historiques du document users", () => {
    expect(mergeRealtimeUserProfile(connected, { section: "CETB", sectionIds: ["cetb"] })).toMatchObject({ section: "CTEB", sectionIds: ["CTEB"] });
  });

  it("conserve l'identité de bootstrap lorsque seules les sections évoluent", () => {
    const identity = (value: AppUser) => `${value.id}:${value.role}:${value.schoolId ?? ""}`;
    const updated = mergeRealtimeUserProfile(connected, { section: "Secondaire", sectionIds: ["Secondaire"] });
    expect(identity(updated)).toBe(identity(connected));
  });
});
