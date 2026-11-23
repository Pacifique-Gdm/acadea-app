import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/** Lot « 3 étapes » : photo facultative d'une justification d'écriture (répartition des frais). */
let environment: RulesTestEnvironment;
const context = (uid = "admin-a", role = "school_admin", schoolId = "school-a") => environment.authenticatedContext(uid, { role, schoolId });
// Nom unique à chaque envoi : la règle interdit de remplacer une photo, et l'émulateur garde les fichiers entre deux tests.
let counter = 0;
const unique = (extension = "jpg") => `recu-papier-${Date.now()}-${++counter}.${extension}`;
const path = (uploader = "admin-a", name = unique(), school = "school-a") => `fee-allocation-proofs/${school}/${uploader}/${name}`;
const upload = (ctx = context(), target = path(), type = "image/jpeg", size = 1024) => ctx.storage().ref(target).put(new Uint8Array(size), { contentType: type });

describe("photos des justifications de la répartition", () => {
  beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-acadea-fee-allocation-proofs", firestore: { rules: readFileSync("firestore.rules", "utf8") }, storage: { rules: readFileSync("storage.rules", "utf8") } }); }, 30_000);
  beforeEach(async () => { await environment.clearFirestore(); await environment.clearStorage(); await environment.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "schools", "school-a"), { status: "active" });
    await setDoc(doc(admin.firestore(), "schools", "school-s"), { status: "suspended" });
  }); });
  afterAll(async () => environment.cleanup(), 30_000);

  it.each([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]])("autorise l'Administrateur de l'école à envoyer %s dans son dossier", async (type, extension) => {
    await assertSucceeds(upload(context(), path("admin-a", unique(extension)), type));
  });
  it("accepte aussi l'ancien rôle « admin » (lu comme Administrateur de l'école)", async () => { await assertSucceeds(upload(context("admin-a", "admin"))); });
  it("refuse toute lecture, même par l'Administrateur qui a envoyé la photo", async () => {
    const target = path();
    await assertSucceeds(upload(context(), target));
    await assertFails(context().storage().ref(target).getDownloadURL());
  });
  it("refuse le remplacement et l'effacement", async () => {
    const target = path();
    await assertSucceeds(upload(context(), target));
    await assertFails(upload(context(), target));
    await assertFails(context().storage().ref(target).delete());
  });
  it("refuse une autre école, le dossier d'un autre, un autre rôle, une école suspendue et un visiteur", async () => {
    await assertFails(upload(context("admin-a", "school_admin", "school-b")));
    await assertFails(upload(context(), path("admin-b")));
    await assertFails(upload(context("cashier-a", "cashier"), path("cashier-a")));
    await assertFails(upload(context("admin-s", "school_admin", "school-s"), path("admin-s", unique(), "school-s")));
    await assertFails(environment.unauthenticatedContext().storage().ref(path()).put(new Uint8Array(10), { contentType: "image/jpeg" }));
  });
  it("refuse un fichier qui n'est pas une image, un nom invalide et plus de 5 Mo", async () => {
    await assertFails(upload(context(), path(), "application/pdf"));
    await assertFails(upload(context(), path("admin-a", "a.jpg")));
    await assertFails(upload(context(), path(), "image/jpeg", 5 * 1024 * 1024 + 1));
  });
});
