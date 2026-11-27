import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regroupement lot 1 (limite de 12 fonctions Vercel) : l'ancienne adresse des demandes
// d'indisponibilité et de l'horaire publié est servie par api/manage-teacher-grading.js.
const mocks = vi.hoisted(() => ({ availability: vi.fn() }));
vi.mock("./teacherAvailabilityHandler.js", () => ({ default: mocks.availability, TEACHER_AVAILABILITY_ROUTE: "teacher-availability" }));
import gradingHandler from "../manage-teacher-grading.js";

const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn(), end: vi.fn() });

describe("regroupement lot 1 : indisponibilités et horaire publié dans manage-teacher-grading", () => {
  beforeEach(() => vi.clearAllMocks());

  it("garde l'ancienne adresse par une redirection interne, avant l'adresse de repli de l'application", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(config.rewrites[0]).toEqual({ source: "/api/manage-teacher-availability-request", destination: "/api/manage-teacher-grading?route=teacher-availability" });
    expect(existsSync(join(process.cwd(), "api", "manage-teacher-availability-request.js"))).toBe(false);
  });

  it("transmet la consultation à l'ancien code avec exactement les mêmes paramètres (repère retiré)", async () => {
    const req = { method: "GET", query: { route: "teacher-availability", view: "published-timetable", schoolYearId: "year-a" }, headers: { authorization: "Bearer t" } };
    const res = response();
    await gradingHandler(req, res);
    expect(mocks.availability).toHaveBeenCalledTimes(1);
    expect(mocks.availability.mock.calls[0][0].query).toEqual({ view: "published-timetable", schoolYearId: "year-a" });
    expect(mocks.availability.mock.calls[0][1]).toBe(res);
  });

  it("transmet aussi les envois (POST) des demandes d'indisponibilité", async () => {
    const req = { method: "POST", query: { route: "teacher-availability" }, headers: {}, body: { action: "CREATE" } };
    await gradingHandler(req, response());
    expect(mocks.availability).toHaveBeenCalledTimes(1);
    expect(mocks.availability.mock.calls[0][0].query).toEqual({});
    expect(mocks.availability.mock.calls[0][0].body).toEqual({ action: "CREATE" });
  });

  it("sans repère, la cotation garde son fonctionnement (GET refusé comme avant)", async () => {
    const res = response();
    await gradingHandler({ method: "GET", query: {}, headers: {} }, res);
    expect(mocks.availability).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
