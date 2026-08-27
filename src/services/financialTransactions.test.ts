import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: mocks.getToken }));

import { createExpenseTransaction, createPaymentTransaction } from "./financialTransactions";

describe("service frontend des transactions financières", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getToken.mockResolvedValue("firebase-token");
  });

  it("attend le paiement confirmé par le serveur et n'envoie pas schoolId ni createdBy", async () => {
    const payment = { id: "payment-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 20, paidAt: "2026-08-07", cashierName: "Caissier" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ payment }), { status: 200 }));
    await expect(createPaymentTransaction({ schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 20, note: "Premier acompte", clientRequestId: "request-payment-001" })).resolves.toEqual(payment);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toEqual({ action: "create-payment", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 20, note: "Premier acompte", clientRequestId: "request-payment-001" });
    expect(request).not.toHaveProperty("schoolId");
    expect(request).not.toHaveProperty("createdBy");
  });

  it("rejette l'erreur serveur sans fabriquer de transaction locale", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Montant financier invalide.", code: "invalid-argument" }), { status: 400 }));
    await expect(createExpenseTransaction({ schoolYearId: "year-a", amount: 0, category: "Fournitures", description: "Papier", beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: "request-expense-001" })).rejects.toThrow("Montant financier invalide.");
  });
});
