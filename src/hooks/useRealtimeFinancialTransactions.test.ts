import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("transactions financières temps réel", () => {
  it("écoute paiements et dépenses avec le même périmètre école/année", () => {
    const source = readFileSync(new URL("./useRealtimeFinancialTransactions.ts", import.meta.url), "utf8");
    expect(source).toContain('annualQuery("payments")');
    expect(source).toContain('annualQuery("expenses")');
    expect(source).toContain('where("schoolId", "==", schoolId)');
    expect(source).toContain('where("schoolYearId", "==", schoolYearId)');
    expect(source).toContain("unsubscribePayments()");
    expect(source).toContain("unsubscribeExpenses()");
  });
});
