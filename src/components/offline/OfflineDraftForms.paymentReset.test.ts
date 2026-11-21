import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { userFacingError } from "../../utils/userFacingError";

const source = readFileSync(new URL("./OfflineDraftForms.tsx", import.meta.url), "utf8");
function submit(captureOfflineDraft: () => Promise<void>) {
  const ast = ts.createSourceFile("form.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body = "";
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === "save") body = node.getText(ast); ts.forEachChild(node, visit); };
  visit(ast);
  const state: Record<string, unknown> = { StudentId: "student-a", FeeTypeId: "fee-a", Amount: "20", Note: "note-a" };
  const setters = Object.fromEntries(["Saving", "Message", "StudentId", "FeeTypeId", "Confirmation", "Score", "Reason", "Amount", "Note"].map(k => [`set${k}`, (v: unknown) => { state[k] = v; }]));
  const bindings = { ...setters, userFacingError, context: {}, savingRef: { current: false }, scope: { userId: "fictif" }, role: "cashier", studentId: "student-a", fee: { id: "fee-a", currency: "USD", amount: 100 }, amount: "20", note: "note-a", captureOfflineDraft };
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { state, save: new Function(...Object.keys(bindings), `${js};return save;`)(...Object.values(bindings)) as () => Promise<void> };
}
describe("paiement provisoire hors connexion", () => {
  it("vide la saisie seulement après confirmation de la file locale", async () => {
    let confirm!: () => void;
    const test = submit(() => new Promise<void>(resolve => { confirm = resolve; }));
    const saving = test.save();
    expect(test.state.StudentId).toBe("student-a");
    confirm(); await saving;
    for (const key of ["StudentId", "FeeTypeId", "Amount", "Note"]) expect(test.state[key]).toBe("");
    expect(test.state.Message).toContain("Aucune opération n'est encore confirmée par le serveur");
  });
  it("conserve les champs si le stockage local échoue", async () => {
    const test = submit(async () => { throw new Error("Stockage indisponible"); });
    await test.save();
    expect(test.state).toMatchObject({ StudentId: "student-a", FeeTypeId: "fee-a", Amount: "20", Note: "note-a", Message: "Stockage indisponible" });
  });
});
