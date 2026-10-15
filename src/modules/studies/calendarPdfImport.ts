import type { SchoolYear } from "../../types";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { validCalendarDate, type CalendarEventKind } from "./schoolCalendar";

export type PdfLine = { page: number; text: string; ocr?: boolean };
export type PdfCandidate = {
  id: string; title: string; kind: CalendarEventKind; startsAt: string; endsAt: string;
  educationLevel: string; sourcePage: number; suspendsCourses: boolean;
  uncertain: boolean; reviewed: boolean; selected: boolean;
};
export type PdfAnalysis = { pageCount: number; candidates: PdfCandidate[]; warnings: string[] };
const months: Record<string, number> = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const iso = (day: number, month: number, year: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const numericDate = /\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](20\d{2})\b/g;
const wordDate = /\b(1(?:er)?|0?[2-9]|[12]\d|3[01])\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(20\d{2})\b/gi;
const partialDate = /\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])\b(?![/.-]\d)/;

function levelOf(text: string): string | undefined {
  const value = normalize(text);
  const matches = [
    ["Maternelle", /maternell|prescolair/], ["Primaire", /primair/],
    ["Secondaire", /secondair|humanit/], ["Technique", /techniqu|cteb/],
  ].filter(([, pattern]) => (pattern as RegExp).test(value)).map(([level]) => level as string);
  return matches.length ? matches.join(" et ") : undefined;
}

function kindOf(title: string): CalendarEventKind | undefined {
  const value = normalize(title);
  if (/vacance|conge/.test(value)) return "vacation";
  if (/ferie/.test(value)) return "holiday";
  if (/suspend|interruption des cours/.test(value)) return "suspension";
  if (/reprise|rentree/.test(value)) return "resumption";
  if (/examen|evaluation|epreuve|test/.test(value)) return "exam";
  if (/conseil de classe|deliberation/.test(value)) return "classCouncil";
  if (/reunion/.test(value)) return "meeting";
  if (/ceremonie|celebration/.test(value)) return "ceremony";
  if (/pedagogique|formation/.test(value)) return "pedagogical";
  if (/activite|administrat|inscription|proclamation|periode scolaire|trimestre/.test(value)) return "activity";
  return undefined;
}

export function parsePdfCalendarLines(lines: PdfLine[], year: SchoolYear, pageCount: number): PdfAnalysis {
  const candidates: PdfCandidate[] = [];
  const warnings: string[] = [];
  let currentLevel = "Non déterminé";
  for (const { page, text, ocr } of lines) {
    const line = text.replace(/\s+/g, " ").trim();
    if (!line || page < 1 || page > pageCount) continue;
    const level = levelOf(line);
    if (level) currentLevel = level;
    const found: { start: number; end: number; value: string; ambiguous: boolean }[] = [];
    for (const match of line.matchAll(numericDate)) {
      const day = Number(match[1]), month = Number(match[2]), yearNumber = Number(match[3]);
      found.push({ start: match.index, end: match.index + match[0].length, value: iso(day, month, yearNumber), ambiguous: day <= 12 });
    }
    for (const match of line.matchAll(wordDate)) {
      found.push({ start: match.index, end: match.index + match[0].length, value: iso(Number.parseInt(match[1], 10), months[normalize(match[2])], Number(match[3])), ambiguous: false });
    }
    found.sort((a, b) => a.start - b.start);
    if (!found.length) {
      if (partialDate.test(line) && kindOf(line)) warnings.push(`Page ${page} : date sans année, ligne non importée.`);
      continue;
    }
    if (found.length > 2 || found.some((date) => !validCalendarDate(date.value)) || (partialDate.test(line.replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]20\d{2}\b/g, "")))) {
      warnings.push(`Page ${page} : dates ambiguës ou incohérentes, ligne non importée.`);
      continue;
    }
    const title = found.reduceRight((value, date) => value.slice(0, date.start) + " " + value.slice(date.end), line)
      .replace(/^(date|période|periode|du|de|au|à|a|:|-|\s)+/i, "")
      .replace(/\b(du|au|de|à)\s*$/i, "").replace(/[|;:\s-]+/g, " ").trim();
    const kind = kindOf(title);
    if (!kind || title.length < 5 || /^(total|nombre|jours|observations|date|période|periode|niveau)/i.test(title)) continue;
    const startsAt = found[0].value, endsAt = found[1]?.value ?? startsAt;
    if (startsAt > endsAt || startsAt < year.startsAt.slice(0, 10) || endsAt > year.endsAt.slice(0, 10)) {
      warnings.push(`Page ${page} : date hors de l'année active ou intervalle inversé, ligne non importée.`);
      continue;
    }
    if (candidates.length >= 100) { warnings.push("Limite de 100 événements atteinte : vérifiez le reste du document manuellement."); break; }
    candidates.push({
      id: crypto.randomUUID(), title: title.slice(0, 120), kind, startsAt, endsAt,
      educationLevel: level ?? currentLevel, sourcePage: page,
      suspendsCourses: kind === "vacation" || kind === "holiday" || kind === "suspension",
      uncertain: Boolean(ocr) || found.some((date) => date.ambiguous) || !(level ?? (currentLevel !== "Non déterminé" ? currentLevel : undefined)),
      reviewed: false, selected: true,
    });
  }
  return { pageCount, candidates, warnings };
}

export async function analyzeCalendarPdf(file: File, year: SchoolYear, onProgress: (fraction: number) => void): Promise<PdfAnalysis> {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error("Le PDF doit faire entre 1 octet et 10 Mo.");
  if (file.type && file.type !== "application/pdf") throw new Error("Le fichier sélectionné n'est pas un PDF.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Le fichier ne possède pas une signature PDF valide.");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({ data: bytes });
  let pdfDocument;
  try { pdfDocument = await task.promise; }
  catch (error) { throw new Error(error instanceof Error && /password/i.test(error.message) ? "PDF protégé par mot de passe : import impossible." : "PDF illisible ou endommagé."); }
  try {
    if (pdfDocument.numPages > 30) throw new Error("Le document dépasse la limite de 30 pages.");
    const lines: PdfLine[] = [];
    const ocrPages: number[] = [];
    let ocrWorker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | undefined;
    const recognizePage = async (page: Awaited<ReturnType<typeof pdfDocument.getPage>>) => {
      if (typeof window === "undefined" || typeof globalThis.document === "undefined") throw new Error("PDF sans texte exploitable : l'OCR locale doit être exécutée dans un navigateur.");
      if (!ocrWorker) {
        const { createWorker } = await import("tesseract.js");
        ocrWorker = await createWorker("fra", undefined, {
          workerPath: new URL("/ocr/worker.min.js", window.location.origin).href,
          corePath: new URL("/ocr/", window.location.origin).href,
          langPath: new URL("/ocr/", window.location.origin).href,
          workerBlobURL: false,
        });
      }
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, Math.sqrt(6_000_000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Rendu du PDF indisponible dans ce navigateur.");
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      try { return (await ocrWorker.recognize(canvas)).data.text; }
      finally { canvas.width = 0; canvas.height = 0; }
    };
    try { for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item && "transform" in item && Boolean(item.str.trim()));
      if (!items.length) {
        ocrPages.push(pageNumber);
        const recognized = await recognizePage(page);
        for (const text of recognized.split(/\r?\n/)) if (text.trim()) lines.push({ page: pageNumber, text, ocr: true });
        onProgress(pageNumber / pdfDocument.numPages);
        continue;
      }
      const rows: { y: number; fragments: { x: number; text: string }[] }[] = [];
      for (const item of items) {
        const x = item.transform[4], y = item.transform[5];
        const row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
        if (row) row.fragments.push({ x, text: item.str });
        else rows.push({ y, fragments: [{ x, text: item.str }] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) lines.push({ page: pageNumber, text: row.fragments.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ") });
      onProgress(pageNumber / pdfDocument.numPages);
    } } finally { await ocrWorker?.terminate(); }
    if (!lines.length) throw new Error("Aucune date ou ligne exploitable n'a été reconnue. Vérifiez le document et saisissez les événements manuellement.");
    const analysis = parsePdfCalendarLines(lines, year, pdfDocument.numPages);
    if (ocrPages.length) analysis.warnings.push(`OCR locale utilisée pour les pages ${ocrPages.join(", ")}. Vérifiez visuellement chaque date et chaque intitulé avant l'ajout au brouillon.`);
    return analysis;
  } finally { await task.destroy(); }
}
