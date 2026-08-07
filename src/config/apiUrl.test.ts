import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "./apiUrl";

describe("résolution des URL API", () => {
  it("conserve une route relative pour Vercel Staging et Production", () => {
    expect(resolveApiUrl("/api/manage-financial-transaction", "")).toBe("/api/manage-financial-transaction");
  });

  it("conserve une route relative avec vercel dev sur la même origine", () => {
    expect(resolveApiUrl("/api/provision-school-account", "   ")).toBe("/api/provision-school-account");
  });

  it("utilise une base explicite pour un serveur API local séparé", () => {
    expect(resolveApiUrl("/api/send-parent-message?schoolYearId=year-a", "http://127.0.0.1:3000/"))
      .toBe("http://127.0.0.1:3000/api/send-parent-message?schoolYearId=year-a");
  });

  it("refuse les chemins qui ne ciblent pas une API Acadéa", () => {
    expect(() => resolveApiUrl("/login", "")).toThrow("Chemin API invalide");
  });
});
