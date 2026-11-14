import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadScreen } from "./lazyScreen";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

describe("écrans chargés à la demande", () => {
  beforeEach(() => { vi.stubGlobal("sessionStorage", memoryStorage()); vi.stubGlobal("navigator", { onLine: true }); });
  afterEach(() => vi.unstubAllGlobals());

  it("recharge la page une seule fois quand un morceau de code a disparu après une mise à jour", async () => {
    const reload = vi.fn();
    const failing = loadScreen(() => Promise.reject(new Error("Failed to fetch dynamically imported module")), reload);
    await expect(failing()).rejects.toThrow();
    await expect(failing()).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ne recharge pas hors connexion (le cache hors ligne garde déjà tous les morceaux)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const reload = vi.fn();
    await expect(loadScreen(() => Promise.reject(new Error("offline")), reload)()).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });

  it("un chargement réussi rouvre la possibilité d'un futur rechargement", async () => {
    const reload = vi.fn();
    await expect(loadScreen(() => Promise.reject(new Error("x")), reload)()).rejects.toThrow();
    await loadScreen(() => Promise.resolve({ ok: true }), reload)();
    await expect(loadScreen(() => Promise.reject(new Error("y")), reload)()).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("les portails par rôle et écrans secondaires ne sont plus dans le code chargé au démarrage", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    for (const name of ["PlatformModule", "ParentPortal", "SecretaryPortal", "TeacherPortal", "CoordinationPortal", "StudyDirectorPortal", "DisciplinePortal", "ControlModule", "MenuModule", "ReportsModule", "MessagesModule"]) {
      expect(app).not.toMatch(new RegExp(`^import \\{ ${name} \\} from`, "m"));
      expect(app).toContain(`const ${name} = lazy(loadScreen(() => import(`);
    }
    // Écrans principaux du directeur gardés au démarrage.
    expect(app).toMatch(/^import \{ Dashboard \} from "\.\/modules\/dashboard\/Dashboard";/m);
    expect(app).toMatch(/^import \{ StudentsModule \} from "\.\/modules\/students\/StudentsModule";/m);
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    expect(main).toContain("<Suspense fallback=");
  });

  it("le mode hors connexion garde en cache tous les morceaux de code produits", () => {
    const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    expect(config).toContain('.filter((path) => path.startsWith("assets/") && (path.endsWith(".js") || path.endsWith(".css")))');
  });
});
