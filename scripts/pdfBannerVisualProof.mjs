#!/usr/bin/env node
/**
 * Preuve visuelle locale du bandeau commun des PDF (logo, nom de l'école,
 * cadre du titre et « Date de génération »).
 *
 * Fabrique chaque type de PDF à bandeau dans un Chromium sans accès réseau,
 * avec des données fictives et la feuille de style compilée de l'application
 * (Tailwind compris : le PDF est dessiné dans la page de l'application),
 * sur un écran d'ordinateur puis de téléphone. Chaque page devient une image PNG.
 *
 *   node scripts/pdfBannerVisualProof.mjs [dossier-de-sortie]
 *
 * Contrôles automatiques, sur la page de travail du PDF une fois dessinée :
 * - le nom de l'école et le titre du document sont en gras (poids ≥ 700) ;
 * - chaque ligne du cadre du titre (date, sous-titre, nombre d'élèves) reste,
 *   telle que html2canvas la dessine vraiment,
 *   dans son cadre, sur une seule ligne.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const outputDir = resolve(process.argv[2] ?? "test-results/pdf-banner-proof");
await mkdir(outputDir, { recursive: true });

const source = (path) => JSON.stringify(resolve(path).replaceAll("\\", "/"));
const entry = resolve(outputDir, "entry.ts");
await writeFile(entry, `
export { generateReceiptPdf, generateExpensePdf, renderAcadPdfPreview, pdfInfoGrid, pdfSection, pdfTable } from ${source("src/utils/pdf.ts")};
export { exportStudentsPdf } from ${source("src/utils/studentPdf.ts")};
export { printPersonnelListPdf, printPersonnelProfilePdf } from ${source("src/utils/personnelPdf.ts")};
export { exportCorrespondenceListPdf } from ${source("src/modules/secretary/secretaryListPdf.ts")};
`);
const bundlePath = resolve(outputDir, "bundle.js");
await build({
  entryPoints: [entry],
  outfile: bundlePath,
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "PdfProof",
  logLevel: "silent",
  // Valeurs fictives (les mêmes que vitest.config.ts) : la page n'a de toute façon aucun accès réseau.
  define: {
    "import.meta.env": JSON.stringify({
      DEV: false,
      VITE_APP_ENV: "staging",
      VITE_FIREBASE_API_KEY: "test-public-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "acadea-staging.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "acadea-staging",
      VITE_FIREBASE_STORAGE_BUCKET: "acadea-staging.firebasestorage.app",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
      VITE_FIREBASE_APP_ID: "1:123:web:test",
    }),
    __ACADEA_APP_VERSION__: JSON.stringify("preuve"),
  },
});

// Feuille de style de l'application, compilée comme pour le site (base Tailwind comprise).
const { default: tailwindConfig } = await import(`file:///${resolve("tailwind.config.js").replaceAll("\\", "/")}`);
const appCss = (await postcss([tailwindcss({ ...tailwindConfig, content: tailwindConfig.content.map((glob) => resolve(glob).replaceAll("\\", "/")) })])
  .process(await readFile("src/styles.css", "utf8"), { from: resolve("src/styles.css") })).css;

const generatedAt = "2026-11-20T23:59:58";
const scenarios = [
  { name: "recu-paiement", kind: "receipt" },
  { name: "justificatif-depense", kind: "expense" },
  { name: "liste-eleves", kind: "students" },
  { name: "liste-personnel", kind: "personnelList" },
  { name: "fiche-personnel", kind: "personnelProfile" },
  { name: "liste-courriers", kind: "correspondence" },
  { name: "rapport", kind: "report" },
  { name: "document-paysage", kind: "landscape" },
  { name: "nom-et-titre-longs", kind: "report", schoolName: "Complexe scolaire évangélique la Grâce de Dieu de Kinshasa-Limete", title: "Rapport financier détaillé des encaissements et des dépenses de la période" },
];
const viewports = [
  { name: "ordinateur", viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, isMobile: false },
  { name: "telephone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];

async function pdfToImages(name, bytes) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false }).promise;
  const files = [];
  for (let index = 1; index <= Math.min(pdf.numPages, 2); index += 1) {
    const sheet = await pdf.getPage(index);
    const viewport = sheet.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await sheet.render({ canvasContext: canvas.getContext("2d"), canvas, viewport }).promise;
    const file = resolve(outputDir, `${name}-page${index}.png`);
    await writeFile(file, canvas.toBuffer("image/png"));
    files.push(file);
  }
  return { pages: pdf.numPages, files };
}

const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const device of viewports) {
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch ?? false });
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><head><meta name=viewport content=\"width=device-width, initial-scale=1\"></head><body></body></html>");
    await page.addStyleTag({ content: appCss });
    await page.addScriptTag({ path: bundlePath });
    // Mesure du bandeau juste avant que le PDF retire sa page de travail.
    await page.evaluate(() => {
      const original = Element.prototype.remove;
      window.__bannerChecks = [];
      Element.prototype.remove = function remove() {
        if (this.classList?.contains("acadea-pdf")) {
          const weight = (selector) => Array.from(this.querySelectorAll(selector)).map((node) => Number(getComputedStyle(node).fontWeight));
          const lines = Array.from(this.querySelectorAll(".document-title small, .document-title span")).map((line) => {
            const frame = line.closest(".document-title").getBoundingClientRect();
            const box = line.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(line);
            const rows = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
            const textRight = Math.max(...Array.from(range.getClientRects()).map((rect) => rect.right));
            // Où html2canvas dessine VRAIMENT les lettres : il mesure la ligne de
            // base dans une boîte posée dans la page de l'application, puis ajoute
            // 2 px (même calcul que son FontMetrics). Le bas des lettres (« g »,
            // « p ») doit rester au-dessus du bord du cadre, avec 1 px de marge.
            const style = getComputedStyle(line);
            const probe = document.createElement("div");
            const probeText = document.createElement("span");
            const probeImage = document.createElement("img");
            Object.assign(probe.style, { visibility: "hidden", position: "absolute", left: "0", top: "0", fontFamily: style.fontFamily, fontSize: style.fontSize, margin: "0", padding: "0", whiteSpace: "nowrap" });
            Object.assign(probeText.style, { fontFamily: style.fontFamily, fontSize: style.fontSize, margin: "0", padding: "0" });
            probeImage.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            Object.assign(probeImage, { width: 1, height: 1 });
            Object.assign(probeImage.style, { margin: "0", padding: "0", verticalAlign: "baseline" });
            probeText.textContent = "Hidden Text";
            probe.append(probeText, probeImage);
            document.body.appendChild(probe);
            const html2canvasBaseline = probeImage.offsetTop - probeText.offsetTop + 2;
            probe.remove();
            const context = document.createElement("canvas").getContext("2d");
            context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const descent = context.measureText(line.textContent).actualBoundingBoxDescent;
            const textTop = Math.min(...Array.from(range.getClientRects()).map((rect) => rect.top));
            const drawnBottom = textTop + html2canvasBaseline + descent;
            const frameStyle = getComputedStyle(line.closest(".document-title"));
            const borderTop = frame.bottom - parseFloat(frameStyle.borderBottomWidth);
            return {
              text: line.textContent.trim(), rows,
              inside: textRight <= frame.right - 1 && drawnBottom <= borderTop - 1 && box.left >= frame.left,
              overflowRight: Math.round(textRight - frame.right),
              marginToBorder: Math.round((borderTop - drawnBottom) * 10) / 10,
            };
          });
          window.__bannerChecks.push({ school: weight(".school-block h1"), title: weight(".document-title h2"), lines });
        }
        return original.call(this);
      };
    });

    for (const scenario of scenarios) {
      const base64 = await page.evaluate(async ({ scenario, generatedAt }) => {
        window.__bannerChecks = [];
        document.querySelectorAll("[data-pdf-download]").forEach((node) => node.closest("div[role=dialog], body > div")?.remove());
        const proof = window.PdfProof;
        const when = new Date(generatedAt);
        const RealDate = Date;
        // Date de génération fixe (la plus longue en français : 20/11/2026 23:59:58).
        window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [when.getTime()])); } static now() { return when.getTime(); } };
        const school = { id: "ecole-fictive", name: scenario.schoolName ?? "École fictive Acadéa", acronym: "EFA", currency: "USD", address: "Avenue fictive 1, Kinshasa", phone: "+243 000 000 000", email: "contact@ecole-fictive.test", motto: "Travail, discipline, réussite" };
        const year = { id: "2026-2027", name: "2026-2027", currency: "USD" };
        const student = { id: "eleve-1", nom: "MUKENDI", postnom: "KABEYA", prenom: "Grâce", matricule: "EL-0001", sexe: "F", className: "3e Humanités", option: "Scientifique", birthDate: "2010-04-02" };
        try {
          switch (scenario.kind) {
            case "receipt":
              await proof.generateReceiptPdf({ id: "pay-1", receiptNumber: "REC-2026-00042", schoolId: school.id, schoolYearId: year.id, studentId: student.id, feeTypeId: "fee-1", feeName: "Frais scolaires", amount: 150, currency: "USD", paidAt: "2026-11-20", cashierName: "Josée NGALULA", note: "Tranche 2" }, student, { name: "Frais scolaires" }, school, "Josée NGALULA");
              break;
            case "expense":
              await proof.generateExpensePdf({ id: "dep-1", schoolId: school.id, schoolYearId: year.id, category: "fournitures", amount: 40, currency: "USD", spentAt: "2026-11-20", description: "Achat de craies", cashierName: "Josée NGALULA" }, school, year, "Josée NGALULA");
              break;
            case "students":
              await proof.exportStudentsPdf(school, year, [student, { ...student, id: "eleve-2", nom: "KABONGO", prenom: "Daniel", sexe: "M", matricule: "EL-0002" }], ["Classe : 3e Humanités"]);
              break;
            case "personnelList":
              await proof.printPersonnelListPdf(school, [{ id: "p1", name: "Josée NGALULA", role: "cashier", phone: "+243 000", email: "josee@ecole-fictive.test", sections: ["secondaire"] }], "active", when);
              break;
            case "personnelProfile":
              await proof.printPersonnelProfilePdf(school, { id: "p1", name: "Josée NGALULA", role: "cashier", phone: "+243 000", email: "josee@ecole-fictive.test", sections: ["secondaire"] }, when);
              break;
            case "correspondence":
              await proof.exportCorrespondenceListPdf({ rows: [{ id: "c1", referenceNumber: "REF-001/2026", date: "2026-11-20", recipient: "Inspection", subject: "Rapport trimestriel" }], school, year, filters: "Aucun", typeLabel: () => "Sortant" });
              break;
            case "landscape":
              await proof.renderAcadPdfPreview({ filename: "paysage.pdf", title: "Grille fictive (paysage)", school, year, subtitle: "Classe : 3e Humanités", studentCount: 2, orientation: "landscape", sections: [proof.pdfTable([{ header: "Élève", render: (row) => row.name }, { header: "Note", render: (row) => row.score, align: "right" }], [{ name: "MUKENDI Grâce", score: 14 }, { name: "KABONGO Daniel", score: 12 }], "Aucun élève")], throwOnError: true });
              break;
            default:
              await proof.renderAcadPdfPreview({ filename: "rapport.pdf", title: scenario.title ?? "Rapport fictif", school, year, subtitle: "Période du 01/11/2026 au 20/11/2026", sections: [proof.pdfSection("Synthèse", proof.pdfInfoGrid([{ label: "Élèves", value: 12 }]))], throwOnError: true });
          }
        } finally {
          window.Date = RealDate;
        }
        const anchors = Array.from(document.querySelectorAll("[data-pdf-download]"));
        const anchor = anchors[anchors.length - 1];
        if (!anchor?.href.startsWith("blob:")) throw new Error("Aucun PDF généré.");
        const buffer = await (await fetch(anchor.href)).arrayBuffer();
        let binary = "";
        new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
        return btoa(binary);
      }, { scenario, generatedAt });
      const name = `${scenario.name}-${device.name}`;
      const bytes = Buffer.from(base64, "base64");
      await writeFile(resolve(outputDir, `${name}.pdf`), bytes);
      const { pages, files } = await pdfToImages(name, bytes);
      const checks = await page.evaluate(() => window.__bannerChecks);
      // PDF_PROOF_DEBUG=1 : affiche les mesures détaillées des lignes du cadre du titre.
      if (process.env.PDF_PROOF_DEBUG) console.log(JSON.stringify(checks.map((check) => check.lines)));
      for (const check of checks) {
        const problems = [];
        if (check.school.some((weight) => weight < 700)) problems.push(`nom de l'école en poids ${check.school.join("/")}`);
        if (check.title.some((weight) => weight < 700)) problems.push(`titre en poids ${check.title.join("/")}`);
        for (const line of check.lines) if (!line.inside || line.rows > 1) problems.push(`« ${line.text} » hors du cadre (${line.rows} ligne(s), droite ${line.overflowRight}px, lettres dessinées à ${line.marginToBorder}px du bord du bas)`);
        console.log(`${name} : ${pages} page(s), nom ${check.school.join("/")}, titre ${check.title.join("/")}${problems.length ? ` -> ${problems.join(" ; ")}` : " -> bandeau correct"}`);
        if (problems.length) failures.push(`${name} : ${problems.join(" ; ")}`);
      }
      console.log(`  images : ${files.join(", ")}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} défaut(s) du bandeau :\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("Preuve visuelle du bandeau terminée sans erreur.");
