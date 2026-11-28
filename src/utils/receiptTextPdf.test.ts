import { beforeAll, describe, expect, it } from "vitest";
import type { Payment, School, Student } from "../types";
import { createReceiptTextPdf } from "./pdf";
import { pdfSafeText, TextPdfWriter } from "./pdfTextEngine";
import { buildReceiptTextPdf, layoutReceiptFields } from "./receiptTextPdf";

const school = { id: "ecole-a", name: "École fictive Acadéa", motto: "Travail et réussite", address: "Avenue 12, Kinshasa", phone: "+243 000", currency: "CDF" } as unknown as School;
const student = { id: "eleve-1", nom: "MUKENDI", postnom: "KABEYA", prenom: "Grâce", matricule: "EL-0001", className: "3e Humanités", option: "Scientifique" } as unknown as Student;
const payment = {
  id: "pay-1", receiptNumber: "REC-2026-00042", schoolId: school.id, schoolYearId: "2026-2027", studentId: student.id,
  feeTypeId: "fee-1", feeName: "Frais scolaires", amount: 1250000, currency: "CDF", paidAt: "2026-11-20", cashierName: "Josée NGALULA",
  note: "Deuxième tranche",
} as unknown as Payment;
const generatedAt = new Date("2026-11-28T09:30:00");
/** Petit PNG valide (1 × 1 pixel). */
const PNG_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

type ExtractedPage = { items: string[]; text: string; width: number; height: number; positions: Array<{ text: string; x: number; y: number }> };

async function extract(bytes: ArrayBuffer): Promise<ExtractedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await task.promise;
  const pages: ExtractedPage[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const positions = (await page.getTextContent()).items
      .flatMap((item) => ("str" in item && item.str ? [{ text: item.str.replace(/\u00a0/g, " "), x: item.transform[4] as number, y: item.transform[5] as number }] : []));
    const items = positions.map((item) => item.text);
    pages.push({ items, text: items.join(" "), width: viewport.width, height: viewport.height, positions });
  }
  await task.destroy();
  return pages;
}

const count = (values: string[], expected: string) => values.filter((value) => value === expected).length;

// Premier chargement de pdfjs (lent sur une machine chargée) : fait une seule fois, avec plus de temps.
beforeAll(async () => { await import("pdfjs-dist/legacy/build/pdf.mjs"); }, 60_000);

describe("Reçu de paiement en vrai texte", () => {
  it("contient le vrai texte : montant entier, élève, numéro du reçu et pied de page, dans les deux exemplaires", async () => {
    const pdf = await createReceiptTextPdf(payment, student, { name: "Frais scolaires" }, school, "Josée NGALULA", "F", generatedAt);
    const pages = await extract(pdf.outputArrayBuffer());
    expect(pages).toHaveLength(1);
    const [page] = pages;
    // Format A4 en points (595 × 842), quel que soit l'appareil.
    expect(Math.round(page.width)).toBe(595);
    expect(Math.round(page.height)).toBe(842);
    // Le montant est un seul morceau de texte : jamais coupé.
    expect(count(page.items, "1 250 000,00 FC")).toBe(2);
    expect(count(page.items, "MUKENDI KABEYA Grâce")).toBe(2);
    expect(count(page.items, "REC-2026-00042")).toBe(2);
    expect(count(page.items, `Généré par Acadéa | ${generatedAt.toLocaleString("fr-FR")}`)).toBe(2);
    expect(count(page.items, "EXEMPLAIRE ÉCOLE")).toBe(1);
    expect(count(page.items, "EXEMPLAIRE PARENT")).toBe(1);
    expect(count(page.items, "Découper ici")).toBe(1);
    expect(count(page.items, "Reçu de paiement")).toBe(2);
    expect(count(page.items, "École fictive Acadéa")).toBe(2);
    expect(count(page.items, "Devise : Travail et réussite")).toBe(2);
    expect(count(page.items, "3e Scientifique")).toBe(2);
    expect(count(page.items, "Josée NGALULA")).toBe(2);
    expect(count(page.items, "Caissière")).toBe(2);
    expect(count(page.items, "DESCRIPTION DU PAIEMENT")).toBe(2);
    expect(count(page.items, "Deuxième tranche")).toBe(2);
    expect(count(page.items, "MONTANT PAYÉ")).toBe(2);
  });

  it("garde un montant en dollars entier et écrit un tiret quand la description est vide", async () => {
    const pdf = await createReceiptTextPdf({ ...payment, amount: 150, currency: "USD", note: "  " } as Payment, student, { name: "Frais scolaires" }, school, "-", "M", generatedAt);
    const [page] = await extract(pdf.outputArrayBuffer());
    expect(count(page.items, "$150,00")).toBe(2);
    expect(count(page.items, "—")).toBe(4); // description vide et caissier inconnu, deux exemplaires
    expect(count(page.items, "Caissier")).toBe(2);
  });

  it("reste sur une seule page avec une description très longue, entièrement écrite", async () => {
    const note = "Versement de la deuxième tranche par l'oncle de l'élève, ".repeat(18).trim();
    const pdf = await createReceiptTextPdf({ ...payment, note } as Payment, student, { name: "Frais scolaires" }, school, "Josée NGALULA", "F", generatedAt);
    const pages = await extract(pdf.outputArrayBuffer());
    expect(pages).toHaveLength(1);
    const words = pages[0].text.replace(/\s+/g, " ");
    expect(words.split("Versement de la deuxième tranche").length - 1).toBe(36);
    expect(count(pages[0].items, "1 250 000,00 FC")).toBe(2);
  });

  it("affiche le logo de l'école quand il existe, sinon les lettres du sigle", async () => {
    const base = {
      title: "Reçu de paiement", school: { name: "G.S AGAPÉ", contactLine: "" }, brandLetters: "GSAGAPÉ",
      copyLabels: ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE PARENT"] as const, generatedAt, fields: [{ label: "Reçu", value: "R-1" }], signatory: { name: "A", role: "Caissier" },
    };
    const withLogo = buildReceiptTextPdf({ ...base, logo: { dataUrl: PNG_PIXEL, format: "PNG", width: 1, height: 1 } });
    const withoutLogo = buildReceiptTextPdf({ ...base, logo: null });
    expect(new TextDecoder("latin1").decode(withLogo.outputArrayBuffer())).toContain("/Subtype /Image");
    const [page] = await extract(withoutLogo.outputArrayBuffer());
    expect(count(page.items, "GSAGAPÉ")).toBe(2);
  });

  it("pèse bien moins lourd qu'un reçu image (moins de 30 Ko sans logo)", async () => {
    const pdf = await createReceiptTextPdf(payment, student, { name: "Frais scolaires" }, school, "Josée NGALULA", "F", generatedAt);
    expect(pdf.outputArrayBuffer().byteLength).toBeLessThan(30_000);
  });

  it.each([
    ["courte", "Deuxième tranche"],
    ["longue", "Versement de la deuxième tranche par l'oncle de l'élève, en espèces, au guichet de l'école"],
  ])("place la description (%s) à droite du montant, sur la même ligne, dans les deux exemplaires", async (_case, note) => {
    const pdf = await createReceiptTextPdf({ ...payment, note } as Payment, student, { name: "Frais scolaires" }, school, "Josée NGALULA", "F", generatedAt);
    const [page] = await extract(pdf.outputArrayBuffer());
    const amounts = page.positions.filter((item) => item.text === "MONTANT PAYÉ");
    const descriptions = page.positions.filter((item) => item.text === "DESCRIPTION DU PAIEMENT");
    expect(amounts).toHaveLength(2);
    expect(descriptions).toHaveLength(2);
    amounts.forEach((amount, index) => {
      expect(descriptions[index].x).toBeGreaterThan(amount.x + 200); // colonne de droite (points PDF)
      expect(Math.abs(descriptions[index].y - amount.y)).toBeLessThan(25); // même ligne de cartes
    });
    expect(page.text.replace(/\s+/g, " ")).toContain(note.split(",")[0]);
  });

  it("place une description large sur une ligne entière, comme la grille de l'ancien reçu", () => {
    const layout = layoutReceiptFields([{ label: "A", value: "1" }, { label: "B", value: "2" }, { label: "C", value: "3" }, { label: "D", value: "4", wide: true }]);
    expect(layout.fields.map((field) => [field.row, field.column])).toEqual([[0, 0], [0, 1], [1, 0], [2, "all"]]);
    expect(layout.rows).toBe(3);
  });
});

describe("Moteur PDF en vrai texte", () => {
  it("rend les espaces fines des nombres insécables et remplace les signes absents de la police", () => {
    expect(pdfSafeText("1\u202f250,00\u00a0FC")).toBe("1\u00a0250,00\u00a0FC");
    expect(pdfSafeText("4e → 5e")).toBe("4e -> 5e");
    expect(pdfSafeText("1 250,00 FC")).toBe("1 250,00\u00a0FC");
    expect(pdfSafeText("Total FCA")).toBe("Total FCA");
  });

  it("ne coupe jamais un montant et réduit sa taille s'il est trop large", () => {
    const pdf = new TextPdfWriter();
    const amount = pdfSafeText("12\u202f345\u202f678,00 FC");
    expect(pdf.wrap(amount, 10, { size: 9 }, { breakLongWords: false })).toEqual([amount]);
    const size = pdf.fitFontSize(amount, 20, { size: 9 });
    expect(size).toBeLessThan(9);
    expect(pdf.textWidth(amount, { size })).toBeLessThanOrEqual(20);
    const lines = pdf.wrap("Frais de la deuxième tranche", 25, { size: 9 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("Frais de la deuxième tranche");
    expect(lines.flatMap((line) => line.split(" "))).toEqual(["Frais", "de", "la", "deuxième", "tranche"]);
    for (const line of lines) expect(pdf.textWidth(line, { size: 9 })).toBeLessThanOrEqual(25);
  });

  it("écrit une très longue liste sans page blanche, en répétant l'en-tête du tableau", async () => {
    const pdf = new TextPdfWriter();
    const rows = Array.from({ length: 1500 }, (_, index) => [`Élève n° ${index + 1}`, "3e Humanités", `${(index * 1000).toLocaleString("fr-FR")},00 FC`]);
    pdf.table([{ header: "Nom", weight: 3 }, { header: "Classe", weight: 2 }, { header: "Montant", weight: 2, align: "right", noWrap: true }], rows);
    pdf.addPageFooters(generatedAt);
    const pages = await extract(pdf.outputArrayBuffer());
    expect(pages.length).toBeGreaterThan(20);
    for (const [index, page] of pages.entries()) {
      // Chaque page a l'en-tête du tableau, au moins une ligne et son numéro : aucune page blanche.
      expect(page.items[0]).toBe("Nom");
      expect(page.items.some((item) => item.startsWith("Élève n° "))).toBe(true);
      expect(page.items).toContain(`Page ${index + 1} / ${pages.length}`);
    }
    const all = pages.flatMap((page) => page.items);
    expect(all.filter((item) => item.startsWith("Élève n° "))).toHaveLength(1500);
    expect(all).toContain("1 499 000,00 FC");
  });

  it("n'ajoute aucune page pour une liste qui tient sur une page, même vide", async () => {
    const pdf = new TextPdfWriter();
    pdf.table([{ header: "Nom", weight: 1 }], []);
    const pages = await extract(pdf.outputArrayBuffer());
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toEqual(["Nom", "Aucune donnée"]);
  });
});
