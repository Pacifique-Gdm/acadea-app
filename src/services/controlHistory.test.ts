import { describe, expect, it } from "vitest";
import type { AppUser } from "../types";
import { loadControlHistoryPage } from "./controlHistory";

const actor = (role: AppUser["role"], schoolId = "school-a") => ({ role, schoolId });

describe("historique financier par établissement et section", () => {
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"] as const)(
    "ne lance pas une requête financière globale pour %s",
    async (role) => {
      await expect(loadControlHistoryPage("payments", "school-a", "year-a", actor(role)))
        .rejects.toThrow("périmètre de section non sécurisé");
      await expect(loadControlHistoryPage("expenses", "school-a", "year-a", actor(role)))
        .rejects.toThrow("périmètre de section non sécurisé");
      await expect(loadControlHistoryPage("cashInflows", "school-a", "year-a", actor(role)))
        .rejects.toThrow("périmètre de section non sécurisé");
    },
  );

  it("refuse également une école étrangère avant la lecture Firestore", async () => {
    await expect(loadControlHistoryPage("payments", "school-b", "year-a", actor("school_admin")))
      .rejects.toThrow("hors établissement");
  });
});
