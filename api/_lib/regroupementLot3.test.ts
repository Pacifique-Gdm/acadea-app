import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regroupement lot 3 (limite de 12 fonctions Vercel) : l'ancienne adresse de création d'école
// est servie par api/manage-school.js.
const mocks = vi.hoisted(() => ({ provision: vi.fn() }));
vi.mock("./provisionSchoolAdminHandler.js", () => ({ default: mocks.provision, PROVISION_SCHOOL_ADMIN_ROUTE: "provision-school-admin" }));
import schoolHandler from "../manage-school.js";

const response = () => ({ statusCode: 0, setHeader: vi.fn(), end: vi.fn() });

describe("regroupement lot 3 : création d'école dans manage-school", () => {
  beforeEach(() => vi.clearAllMocks());

  it("garde l'ancienne adresse par une redirection interne, avant l'adresse de repli de l'application", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    const index = config.rewrites.findIndex((rule: { source: string }) => rule.source === "/api/provision-school-admin");
    expect(config.rewrites[index]).toEqual({ source: "/api/provision-school-admin", destination: "/api/manage-school?route=provision-school-admin" });
    expect(index).toBeLessThan(config.rewrites.length - 1);
    expect(config.rewrites.at(-1).destination).toBe("/index.html");
    expect(existsSync(join(process.cwd(), "api", "provision-school-admin.js"))).toBe(false);
  });

  it("transmet la création à l'ancien code, repère retiré et corps intact", async () => {
    const req = { method: "POST", query: { route: "provision-school-admin" }, headers: { authorization: "Bearer t" }, body: { schoolName: "École" } };
    const res = response();
    await schoolHandler(req, res);
    expect(mocks.provision).toHaveBeenCalledTimes(1);
    expect(mocks.provision.mock.calls[0][0].query).toEqual({});
    expect(mocks.provision.mock.calls[0][0].body).toEqual({ schoolName: "École" });
    expect(mocks.provision.mock.calls[0][1]).toBe(res);
  });

  it("la lecture publique de l'image de connexion n'est pas détournée", async () => {
    await schoolHandler({ method: "POST", query: {}, headers: {} }, response());
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("sans repère, la gestion des écoles garde son fonctionnement (GET refusé comme avant)", async () => {
    const res = response();
    await schoolHandler({ method: "GET", query: {}, headers: {} }, res);
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(405);
  });
});
