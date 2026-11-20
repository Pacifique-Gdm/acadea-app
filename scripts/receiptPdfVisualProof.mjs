#!/usr/bin/env node
/**
 * Preuve visuelle locale du reçu de paiement (et d'autres PDF de l'en-tête commun).
 *
 * Fabrique les PDF dans un Chromium sans aucun accès réseau, avec des données
 * fictives, puis transforme chaque page en image PNG pour les regarder.
 *
 *   node scripts/receiptPdfVisualProof.mjs [dossier-de-sortie]
 *
 * Contrôle automatique : chaque reçu tient sur une seule page (description
 * vide, courte et de 1000 caractères). Le reste se vérifie en regardant les images.
 * PDF_PROOF_APP_CSS=<fichier.css> ajoute la feuille de style compilée de l'application.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const outputDir = resolve(process.argv[2] ?? "test-results/receipt-pdf-proof");
await mkdir(outputDir, { recursive: true });

const entry = resolve(outputDir, "entry.ts");
await writeFile(entry, `
export { generateReceiptPdf, generateExpensePdf, renderAcadPdfPreview, pdfInfoGrid, pdfSection, buildTwoCopyPdfHtml } from ${JSON.stringify(resolve(process.env.PDF_PROOF_SOURCE ?? "src/utils/pdf.ts").replaceAll("\\", "/"))};
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
  define: { "import.meta.env": JSON.stringify({ DEV: false, VITE_APP_ENV: "test" }) },
});

// Logo fictif : carré bleu avec un cercle clair (aucune lettre dedans).
const logoCanvas = createCanvas(120, 120);
const logoContext = logoCanvas.getContext("2d");
logoContext.fillStyle = "#1d4ed8";
logoContext.fillRect(0, 0, 120, 120);
logoContext.fillStyle = "#facc15";
logoContext.beginPath();
logoContext.arc(60, 60, 34, 0, Math.PI * 2);
logoContext.fill();
const logoDataUrl = `data:image/png;base64,${logoCanvas.toBuffer("image/png").toString("base64")}`;

const longNote = ("Paiement de la deuxième tranche des frais scolaires, versé par l'oncle de l'élève au guichet, "
  + "avec un reliquat à régler au prochain trimestre selon l'accord passé avec la direction. ").repeat(6).slice(0, 1000);
const scenarios = [
  { name: "recu-sans-logo", note: "", logo: false },
  { name: "recu-sans-logo-sigle-long", note: "Tranche 1", logo: false, schoolName: "G.S AGAPÉ", acronym: "GSAGAPÉ" },
  { name: "recu-sans-logo-nom-seul", note: "", logo: false, schoolName: "G.S AGAPÉ (essai reçu)" },
  { name: "recu-sans-logo-staging", note: "", logo: false, schoolName: "G.S AGAPÉ (essai reçu)", acronym: "GSAGAPÉ" },
  { name: "recu-description-vide", note: "" },
  { name: "recu-description-courte", note: "Tranche 2 – septembre" },
  { name: "recu-description-longue", note: longNote },
  { name: "recu-arriere-description-longue", note: longNote, arrear: true },
];

async function pdfToImages(name, bytes) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false }).promise;
  const files = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const sheet = await pdf.getPage(index);
    const viewport = sheet.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await sheet.render({ canvasContext: canvas.getContext("2d"), canvas, viewport }).promise;
    const file = resolve(outputDir, `${name}-page${index}.png`);
    await writeFile(file, canvas.toBuffer("image/png"));
    files.push(file);
    if (index === 1) logoInk.set(name, logoSquareInk(canvas));
  }
  return { pages: pdf.numPages, files };
}

/**
 * Encre (pixels foncés) à l'intérieur du carré du logo, sur chacun des deux
 * exemplaires d'un reçu A4 rendu à l'échelle 2. Sans image de logo, les lettres
 * de secours doivent y être réellement dessinées (pas seulement dans la page :
 * html2canvas a déjà rogné des lettres que le navigateur affichait bien).
 */
function logoSquareInk(canvas) {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  return [0.052, 0.503].map((top) => {
    const x = Math.round(width * 0.09), y = Math.round(height * top), w = Math.round(width * 0.035), h = Math.round(height * 0.026);
    const pixels = context.getImageData(x, y, w, h).data;
    let ink = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] < 160 && pixels[offset + 1] < 160) ink += 1;
    return ink;
  });
}
const logoInk = new Map();

const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/*", (route) => route.abort());
  await page.setContent("<!doctype html><html><body></body></html>");
  // Feuille de style compilée de l'application (facultatif) : le PDF est
  // dessiné dans la page de l'application, donc ses styles globaux s'y appliquent.
  if (process.env.PDF_PROOF_APP_CSS) await page.addStyleTag({ path: resolve(process.env.PDF_PROOF_APP_CSS) });
  await page.addScriptTag({ path: bundlePath });

  async function capture(kind, options) {
    const base64 = await page.evaluate(async ({ kind, options }) => {
      document.querySelectorAll("[data-pdf-download]").forEach((node) => node.closest("div[role=dialog], body > div")?.remove());
      const proof = window.PdfProof;
      const school = { id: "ecole-fictive", name: options.schoolName ?? "École fictive Acadéa", ...(options.acronym ? { acronym: options.acronym } : {}), currency: "USD", address: "Avenue fictive 1", phone: "+243 000 000 000", ...(options.logo === false ? {} : { logoUrl: options.logoDataUrl }) };
      const student = { id: "eleve-1", nom: "MUKENDI", postnom: "KABEYA", prenom: "Grâce", matricule: "EL-0001", className: "3e Humanités", option: "Scientifique" };
      if (kind === "receipt") {
        const payment = {
          id: "pay-1", receiptNumber: "REC-2026-00042", schoolId: school.id, schoolYearId: "2026-2027", studentId: student.id,
          feeTypeId: "fee-1", feeName: "Frais scolaires", amount: 150, currency: "USD", paidAt: "2026-11-20", cashierName: "Josée NGALULA",
          note: options.note,
          ...(options.arrear ? { collectionSchoolYearId: "2026-2027", debtSchoolYearName: "2025-2026" } : {}),
        };
        await proof.generateReceiptPdf(payment, student, { name: "Frais scolaires" }, school, "Josée NGALULA", options.gender);
      } else if (kind === "expense") {
        await proof.generateExpensePdf({ id: "dep-1", schoolId: school.id, schoolYearId: "2026-2027", category: "fournitures", amount: 40, currency: "USD", spentAt: "2026-11-20", description: "Achat de craies", cashierName: "Josée NGALULA" }, school, { id: "2026-2027", name: "2026-2027" }, "Josée NGALULA");
      } else {
        await proof.renderAcadPdfPreview({ filename: "rapport.pdf", title: "Rapport fictif", school, year: { id: "2026-2027", name: "2026-2027" }, sections: [proof.pdfSection("Synthèse", proof.pdfInfoGrid([{ label: "Élèves", value: 12 }]))], throwOnError: true });
      }
      const anchors = Array.from(document.querySelectorAll("[data-pdf-download]"));
      const anchor = anchors[anchors.length - 1];
      if (!anchor?.href.startsWith("blob:")) throw new Error("Aucun PDF généré.");
      const buffer = await (await fetch(anchor.href)).arrayBuffer();
      let binary = "";
      new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
      return btoa(binary);
    }, { kind, options: { ...options, logoDataUrl } });
    return Buffer.from(base64, "base64");
  }

  for (const scenario of scenarios) {
    const bytes = await capture("receipt", scenario);
    await writeFile(resolve(outputDir, `${scenario.name}.pdf`), bytes);
    const { pages, files } = await pdfToImages(scenario.name, bytes);
    console.log(`${scenario.name} : ${pages} page(s) -> ${files.join(", ")}`);
    if (pages !== 1) failures.push(`${scenario.name} : ${pages} pages au lieu d'une seule.`);
    if (scenario.logo === false) {
      const ink = logoInk.get(scenario.name);
      console.log(`${scenario.name} : encre des lettres dans le carré du logo = ${ink.join(" / ")} pixels`);
      if (ink.some((value) => value < 40)) failures.push(`${scenario.name} : lettres du logo de secours absentes ou rognées (${ink.join(" / ")}).`);
    }
  }
  // Le logo de secours en lettres reste dans son carré, quel que soit le sigle.
  for (const [name, acronym] of [["G.S AGAPÉ", "GSAGAPÉ"], ["Complexe scolaire Élite", "CSÉLITEPLUS"], ["École", undefined], ["Institut", "IÉ"]]) {
    const overflow = await page.evaluate(({ name, acronym }) => {
      const host = document.createElement("div");
      host.className = "acadea-pdf";
      host.innerHTML = window.PdfProof.buildTwoCopyPdfHtml({ title: "Reçu", school: { id: "x", name, ...(acronym ? { acronym } : {}) }, generatedAt: new Date(), logoDataUrl: "", showDocumentTitle: true, centerDocumentTitle: false, sections: ["<p>x</p>"], pdfSettings: { fontFamily: "Aptos", fontSize: 10, lineSpacing: 1.4, margins: "normal", paperSize: "A4" }, renderWidth: 794, renderHeight: 1100, copyLabels: ["A", "B"] });
      document.body.appendChild(host);
      const problems = Array.from(host.querySelectorAll(".brand-mark")).map((box) => {
        const letters = box.querySelector("span");
        if (!letters) return "aucune lettre";
        const outer = box.getBoundingClientRect(), inner = letters.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(letters);
        const lines = range.getClientRects().length;
        return lines > 1 || letters.scrollWidth > letters.clientWidth + 1 || inner.bottom > outer.bottom + 0.5 || inner.top < outer.top - 0.5 ? `${lines} ligne(s), largeur ${letters.scrollWidth}/${letters.clientWidth}` : "";
      }).filter(Boolean);
      host.remove();
      return problems;
    }, { name, acronym });
    console.log(`logo de secours « ${acronym ?? name} » : ${overflow.length ? overflow.join(" ; ") : "dans le carré"}`);
    if (overflow.length) failures.push(`Logo de secours « ${acronym ?? name} » hors du carré : ${overflow.join(" ; ")}`);
  }
  for (const kind of ["expense", "report"]) {
    const bytes = await capture(kind, {});
    const { pages, files } = await pdfToImages(kind, bytes);
    console.log(`${kind} : ${pages} page(s) -> ${files.join(", ")}`);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Preuve visuelle terminée sans erreur.");
