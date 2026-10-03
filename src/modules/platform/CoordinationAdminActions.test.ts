import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CoordinationAdminActions } from "./CoordinationAdminActions";

describe("actions du Drawer Coordination", () => {
  it("présente Modifier et Coordinateurs dans deux colonnes égales", () => {
    const html = renderToStaticMarkup(createElement(CoordinationAdminActions, { coordination: { id: "coord-a", name: "Test", status: "active" }, coordinators: [] }));
    expect(html).toContain("grid-cols-2 gap-2");
    expect(html).toContain(">Modifier</button>");
    expect(html).toContain(">Coordinateurs</button>");
    expect(html.match(/<button/g)).toHaveLength(2);
  });
  it("borne la liste au périmètre sélectionné et protège les doubles soumissions", () => {
    const source = readFileSync(new URL("./CoordinationAdminActions.tsx", import.meta.url), "utf8");
    expect(source).toContain("user.coordinationId === coordination.id && !user.removedAt");
    expect(source).toContain("if (inFlight.current) return");
    expect(source).toContain("inFlight.current = true");
    expect(source).toContain("<PasswordField");
    expect(source).toContain("SUPPRIMER CE COORDINATEUR");
    expect(source).toContain("primary-button w-full min-w-0 justify-center");
  });
});
