import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CoordinationAdminActions } from "./CoordinationAdminActions";

describe("actions du Drawer Coordination", () => {
  it("présente Modifier et Coordinateurs dans deux colonnes égales", () => {
    const html = renderToStaticMarkup(createElement(CoordinationAdminActions, { coordination: { id: "coord-a", name: "Test", status: "active" }, coordinators: [], children: createElement("p", null, "Informations Coordination"), onClose: () => undefined }));
    expect(html).toContain("grid-cols-2 gap-2");
    expect(html).toContain(">Modifier</button>");
    expect(html).toContain(">Coordinateurs</button>");
    expect(html).toContain("Informations Coordination");
    expect(html.match(/<button/g)).toHaveLength(3);
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
  it("affiche un seul Drawer à la fois et revient aux informations sans perdre les actions", () => {
    const source = readFileSync(new URL("./CoordinationAdminActions.tsx", import.meta.url), "utf8");
    expect(source).toContain('key={panel ?? "details"}');
    expect(source).toContain('title={panel === "edit" ? "Modifier la Coordination" : panel === "coordinators" ? "Coordinateurs" : coordination.name}');
    expect(source).toContain('onClose={panel ? closePanel : onClose}');
    expect(source).toContain('{!panel && <>');
    expect(source).toContain('{panel === "edit" && <form');
    expect(source).toContain('{panel === "coordinators" && <div');
    expect(source).toContain('if (saved) setPanel(null)');
  });
});
