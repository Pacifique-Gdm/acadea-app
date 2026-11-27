import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regroupement lot 2 (limite de 12 fonctions Vercel) : l'ancienne adresse des années de la coordination
// est servie par api/manage-coordination.js.
const mocks = vi.hoisted(() => ({ years: vi.fn() }));
vi.mock("./coordinationSchoolYearsHandler.js", () => ({ default: mocks.years, COORDINATION_SCHOOL_YEARS_ROUTE: "coordination-school-years" }));
import coordinationHandler from "../manage-coordination.js";

const response = () => ({ statusCode: 0, setHeader: vi.fn(), end: vi.fn() });

describe("regroupement lot 2 : années de la coordination dans manage-coordination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("garde l'ancienne adresse par une redirection interne, avant l'adresse de repli de l'application", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    const index = config.rewrites.findIndex((rule: { source: string }) => rule.source === "/api/manage-coordination-school-years");
    expect(config.rewrites[index]).toEqual({ source: "/api/manage-coordination-school-years", destination: "/api/manage-coordination?route=coordination-school-years" });
    expect(index).toBeLessThan(config.rewrites.length - 1);
    expect(config.rewrites.at(-1).destination).toBe("/index.html");
    expect(existsSync(join(process.cwd(), "api", "manage-coordination-school-years.js"))).toBe(false);
  });

  it("transmet la demande à l'ancien code, repère retiré et corps intact", async () => {
    const req = { method: "POST", query: { route: "coordination-school-years" }, headers: { authorization: "Bearer t" }, body: { action: "status" } };
    const res = response();
    await coordinationHandler(req, res);
    expect(mocks.years).toHaveBeenCalledTimes(1);
    expect(mocks.years.mock.calls[0][0].query).toEqual({});
    expect(mocks.years.mock.calls[0][0].body).toEqual({ action: "status" });
    expect(mocks.years.mock.calls[0][1]).toBe(res);
  });

  it("transmet aussi un GET tel quel : l'ancien code le refuse comme avant (405)", async () => {
    await coordinationHandler({ method: "GET", query: { route: "coordination-school-years" }, headers: {} }, response());
    expect(mocks.years).toHaveBeenCalledTimes(1);
    expect(mocks.years.mock.calls[0][0].method).toBe("GET");
  });

  it("sans repère, la coordination garde son fonctionnement (GET refusé comme avant)", async () => {
    const res = response();
    await coordinationHandler({ method: "GET", query: {}, headers: {} }, res);
    expect(mocks.years).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(405);
  });
});
