import { describe, expect, it } from "vitest";
import { filterSchoolTimeZones, formatIndicativeUtcOffset, schoolTimeZoneOptions } from "./schoolTimeZones";

describe("school time zone picker data", () => {
  const options = schoolTimeZoneOptions(new Date("2026-01-15T12:00:00Z"));

  it("propose des identifiants IANA valides et place les deux fuseaux RDC en premier", () => {
    expect(options.length).toBeGreaterThan(400);
    expect(options.slice(0, 2).map((option) => option.value)).toEqual(["Africa/Kinshasa", "Africa/Lubumbashi"]);
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
    for (const option of options) expect(() => new Intl.DateTimeFormat("fr", { timeZone: option.value })).not.toThrow();
    expect(options[0]).toMatchObject({ city: "Kinshasa", country: "République démocratique du Congo (RDC)", offset: "UTC+01:00" });
    expect(options[1]).toMatchObject({ city: "Lubumbashi", country: "République démocratique du Congo (RDC)", offset: "UTC+02:00" });
  });

  it("recherche ville, pays, RDC et identifiant IANA sans tenir compte des accents", () => {
    expect(filterSchoolTimeZones(options, "kinshasa").map((option) => option.value)).toContain("Africa/Kinshasa");
    expect(filterSchoolTimeZones(options, "republique democratique congo").map((option) => option.value)).toEqual(expect.arrayContaining(["Africa/Kinshasa", "Africa/Lubumbashi"]));
    expect(filterSchoolTimeZones(options, "RDC").map((option) => option.value)).toEqual(expect.arrayContaining(["Africa/Kinshasa", "Africa/Lubumbashi"]));
    expect(filterSchoolTimeZones(options, "America/New_York").map((option) => option.value)).toContain("America/New_York");
    expect(filterSchoolTimeZones(options, "ville-inexistante")).toEqual([]);
  });

  it("affiche le décalage saisonnier de la date consultée sans l'enregistrer à la place de l'IANA", () => {
    expect(formatIndicativeUtcOffset("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("UTC-05:00");
    expect(formatIndicativeUtcOffset("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe("UTC-04:00");
    expect(formatIndicativeUtcOffset("Africa/Kinshasa", new Date("2026-07-15T12:00:00Z"))).toBe("UTC+01:00");
  });
});
