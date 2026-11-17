import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { offlineFeeLabel } from "./OfflineDraftForms";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("lot 26c : cas sociaux et prises en charge", () => {
  it("hors connexion, le Caissier voit le montant net après réduction, pas le tarif officiel", () => {
    const fee = { id: "minerval", name: "Minerval", amount: 100, currency: "USD" as const };
    expect(offlineFeeLabel(fee, { netByFee: { minerval: 50 } })).toContain("50");
    expect(offlineFeeLabel(fee, { netByFee: { minerval: 50 } })).toContain("après réduction");
    expect(offlineFeeLabel(fee, { netByFee: { minerval: 50 } })).not.toContain("100");
    expect(offlineFeeLabel(fee, {})).toContain("100");
  });
  it("le drawer est en consultation seule pour tout rôle autre que l'Administrateur", () => {
    const source = readFileSync(new URL("../../modules/menu/SocialSupportDrawer.tsx", import.meta.url), "utf8");
    expect(source).toContain('const readOnly = readOnlyRequested || !["school_admin", "admin"].includes(user.role);');
  });
  it("plus aucune trace de « tiers » dans les écrans, formulaires, reçus et rapports", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const offenders = sourceFiles(root).filter((path) => /tiers|third-party|Engagement historique/i.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
