import { describe, expect, it, vi } from "vitest";
import { publicationReader, runPublicationTransaction, validatePublicationWrites } from "./publicationTransaction.js";

describe("publication transactionnelle bornée", () => {
  it("lit les documents et les requêtes même vides exclusivement par la transaction", async () => {
    const directGet = vi.fn(() => { throw new Error("Lecture hors transaction"); });
    const query = { where: vi.fn(), limit: vi.fn(), get: directGet };
    query.where.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const doc = { get: directGet };
    const tx = { get: vi.fn(async (ref) => ref === doc ? { exists: false } : { docs: [] }) };
    const reader = publicationReader({ doc: () => doc, collection: () => query }, tx);
    await reader.doc("x/y").get();
    await reader.collection("payments").where("studentId", "==", "child").get();
    expect(tx.get.mock.calls.map(([ref]) => ref)).toEqual([doc, query]);
    expect(query.limit).toHaveBeenCalledWith(2001);
    expect(directGet).not.toHaveBeenCalled();
  });
  it("refuse les requêtes tronquées au lieu de publier un sous-ensemble", async () => {
    const query = { limit: () => query };
    const tx = { get: async () => ({ docs: Array.from({ length: 2001 }, () => ({ data: () => ({}) })) }) };
    await expect(publicationReader({ collection: () => query }, tx).collection("gradeEntries").get()).rejects.toMatchObject({ status: 409 });
  });
  it.each([4, 10, "aborted", "deadline-exceeded"])("traduit %s en conflit réessayable sans nouvelle tentative serveur", async (code) => {
    const db = { runTransaction: vi.fn(async () => { throw { code }; }) };
    await expect(runPublicationTransaction(db, () => undefined)).rejects.toMatchObject({ status: 409, code: "publication-conflict" });
    expect(db.runTransaction).toHaveBeenCalledWith(expect.any(Function), { maxAttempts: 1 });
  });
  it("borne les écritures avant tout engagement", () => {
    expect(() => validatePublicationWrites(Array.from({ length: 401 }, () => ({})))).toThrow();
    expect(() => validatePublicationWrites([{ data: "x".repeat(513 * 1024) }])).toThrow();
    expect(() => validatePublicationWrites([{ status: "published" }])).not.toThrow();
  });
});
