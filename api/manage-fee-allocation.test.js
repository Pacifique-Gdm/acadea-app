import { describe, expect, it } from "vitest";
import handler from "./manage-fee-allocation.js";

function response() {
  const headers = new Map();
  return { statusCode: 0, setHeader: (name, value) => headers.set(name, value),
    end(value) { this.body = JSON.parse(value); }, headers };
}

describe("point d'entrée de répartition des frais", () => {
  it("refuse la méthode GET avant toute lecture", async () => {
    const res = response();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });
  it("refuse toute requête sans session avant l'initialisation Admin SDK", async () => {
    const res = response();
    await handler({ method: "POST", headers: {}, body: { action: "activate" } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("unauthenticated");
  });
});
