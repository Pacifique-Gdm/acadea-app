import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Super Administrateur — devise annuelle", () => {
  const source = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");

  it("sépare la modification de la monnaie de celle des informations et du motto", () => {
    expect(source).toContain('action: "change-currency"');
    expect(source).toContain("schoolYearId: currencyChangeTarget.year.id");
    expect(source).toContain('confirmation: currencyChangeConfirmation');
    expect(source).not.toContain('window.prompt("Devise (USD ou CDF)"');
    expect(source).toContain("Devise monétaire de l'année active");
  });

  it("désactive la confirmation tant que la phrase n'est pas strictement identique", () => {
    expect(source).toContain('currencyChangeConfirmation !== "CHANGER LA DEVISE"');
    expect(source).not.toContain("currencyChangeConfirmation.trim()");
    expect(source).not.toContain("currencyChangeConfirmation.toUpperCase()");
  });
});
