import type { SchoolYear } from "../../types";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { validCalendarDate, type CalendarEventKind } from "./schoolCalendar";

export type PdfLine = { page: number; text: string; ocr?: boolean };
export type PdfCandidate = {
  id: string; title: string; kind: CalendarEventKind; startsAt: string; endsAt: string;
  educationLevel: string; sourcePage: number; suspendsCourses: boolean;
  uncertain: boolean; status: "to-review" | "verified" | "rejected"; reviewed: boolean; selected: boolean; sourceExcerpt: string;
};
export type PdfAnalysis = { pageCount: number; candidates: PdfCandidate[]; warnings: string[]; documentYear?: string };
export function isImportablePdfCandidate(candidate: PdfCandidate): boolean {
  return candidate.selected && candidate.status === "verified" && candidate.reviewed
    && Boolean(candidate.title.trim()) && Boolean(candidate.educationLevel.trim())
    && candidate.educationLevel !== "Non déterminé"
    && validCalendarDate(candidate.startsAt) && validCalendarDate(candidate.endsAt)
    && candidate.startsAt <= candidate.endsAt;
}
const months: Record<string, number> = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const iso = (day: number, month: number, year: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const numericDate = /\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](20\d{2})\b/g;
const wordDate = /\b(1(?:er|°["’]?)?|0?[2-9]|[12]\d|3[01])\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(20\d{2})\b/gi;
const partialDate = /\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])\b(?![/.-]\d)/;

function levelOf(text: string): string | undefined {
  const value = normalize(text);
  if (/secondaire\s+cycle\s+court/.test(value)) return "Secondaire cycle court";
  if (/secondaire\s+cycle\s+long/.test(value)) return "Secondaire cycle long";
  const matches = [
    ["Maternelle", /maternel|prescolair/], ["Primaire", /primair/],
    ["Secondaire", /secondair|humanit/], ["Technique", /techniqu|cteb/],
  ].filter(([, pattern]) => (pattern as RegExp).test(value)).map(([level]) => level as string);
  return matches.length ? matches.join(" et ") : undefined;
}

function kindOf(title: string): CalendarEventKind | undefined {
  const value = normalize(title);
  const leadingEvent = value.replace(/^[\s*+»«•–—-]*(?:\d+(?:er|ere|eme|e|°|è)?\s*)?/, "")
    .replace(/^(?:maternelle?|primaire|secondaire(?:\s+et\s+technique)?)\s+/, "");
  if (/^(vacances?|conges?)\b/.test(leadingEvent)) return "vacation";
  if (/^(jour ferie|ferie|fete)\b/.test(leadingEvent)) return "holiday";
  if (/^(suspension|interruption des cours)\b/.test(leadingEvent)) return "suspension";
  if (/^(reprise|rentree)\b/.test(leadingEvent)) return "resumption";
  if (/^(examens?|evaluations?|epreuves?|tests?)\b/.test(leadingEvent)) return "exam";
  if (/^(conseil de classe|(?:\d+(?:er|eme|e)\s+)?deliberation)\b/.test(leadingEvent)) return "classCouncil";
  if (/^reunion\b/.test(leadingEvent)) return "meeting";
  if (/^(ceremonie|celebration)\b/.test(leadingEvent)) return "ceremony";
  if (/^(journee pedagogique|formation)\b/.test(leadingEvent)) return "pedagogical";
  if (/^(activite|inscription|proclamation|cloture)\b/.test(leadingEvent)) return "activity";
  return undefined;
}

const weekdayIndexes: Record<string, number> = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
function weekdayMismatch(line: string, dates: { start: number; value: string }[]): boolean {
  return dates.some((date) => {
    const prefix = normalize(line.slice(Math.max(0, date.start - 25), date.start));
    const day = prefix.match(/(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s*$/)?.[1];
    return day !== undefined && new Date(`${date.value}T12:00:00Z`).getUTCDay() !== weekdayIndexes[day];
  });
}

export function parsePdfCalendarLines(lines: PdfLine[], year: SchoolYear, pageCount: number): PdfAnalysis {
  const candidates: PdfCandidate[] = [];
  const warnings: string[] = [];
  const documentYears = new Set(lines.filter(({ text }) => /^\s*calendrier\s+scolaire\b/i.test(normalize(text))).flatMap(({ text }) => [...text.matchAll(/\b(20\d{2})\s*[-–—]\s*(20\d{2})\b/g)].map((match) => `${match[1]}-${match[2]}`)));
  const documentYear = documentYears.size === 1 ? [...documentYears][0] : undefined;
  if (documentYears.size > 1) warnings.push("Plusieurs années scolaires sont indiquées dans le PDF : vérifiez le document avant import.");
  if (documentYear && documentYear !== year.name.trim()) throw new Error(`Le PDF concerne ${documentYear}, mais l'année scolaire sélectionnée est ${year.name}. Sélectionnez une année correspondante.`);
  let currentLevel = "Non déterminé";
  let currentPage = 0;
  let inLegalHolidays = false;
  for (const { page, text, ocr } of lines) {
    const line = text.replace(/\s+/g, " ").trim();
    if (!line || page < 1 || page > pageCount) continue;
    if (page !== currentPage) { currentPage = page; currentLevel = "Non déterminé"; inLegalHolidays = false; }
    if (/\bjours feries legaux\b|^conformement a l['’]ordonnance\b/.test(normalize(line))) inLegalHolidays = true;
    const level = levelOf(line);
    if (level && (!ocr || /\benseignement\b|\bsecondaire\s+cycle\s+(?:court|long)\b|^\s*(?:calendrier\s+)?(?:maternelle|primaire|secondaire(?:\s+et\s+technique)?)\s*$/i.test(normalize(line)))) currentLevel = level;
    const found: { start: number; end: number; value: string; ambiguous: boolean }[] = [];
    for (const match of line.matchAll(numericDate)) {
      const day = Number(match[1]), month = Number(match[2]), yearNumber = Number(match[3]);
      found.push({ start: match.index, end: match.index + match[0].length, value: iso(day, month, yearNumber), ambiguous: day <= 12 });
    }
    for (const match of line.matchAll(wordDate)) {
      found.push({ start: match.index, end: match.index + match[0].length, value: iso(Number.parseInt(match[1], 10), months[normalize(match[2])], Number(match[3])), ambiguous: false });
    }
    found.sort((a, b) => a.start - b.start);
    if (ocr && (/\bdu\b.*\bau\b/i.test(normalize(line)) || /\b\d{1,2}\s+et\s+\w+\s+\d{1,2}\b/i.test(normalize(line))) && found.length < 2) {
      const boundary = /\s+du\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}\s+et\s+(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.exec(line);
      const title = boundary ? line.slice(0, boundary.index).replace(/^[\s*+»«•–—-]+/, "").trim() : "";
      const kind = title ? kindOf(title) : undefined;
      if (kind && title.length >= 5 && candidates.length < 100) {
        candidates.push({ id: crypto.randomUUID(), title: title.slice(0, 120), kind, startsAt: "", endsAt: "", educationLevel: currentLevel, sourcePage: page, suspendsCourses: false, uncertain: true, status: "to-review", reviewed: false, selected: false, sourceExcerpt: line.slice(0, 500) });
        warnings.push(`Page ${page} : plage OCR incomplète, dates à renseigner à partir du PDF original.`);
      } else warnings.push(`Page ${page} : plage OCR incomplète, ligne non importée.`);
      continue;
    }
    if (!found.length) {
      if (partialDate.test(line) && kindOf(line)) warnings.push(`Page ${page} : date sans année, ligne non importée.`);
      continue;
    }
    if (found.length > 2 || found.some((date) => !validCalendarDate(date.value)) || (partialDate.test(line.replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]20\d{2}\b/g, "")))) {
      warnings.push(`Page ${page} : dates ambiguës ou incohérentes, ligne non importée.`);
      continue;
    }
    if (ocr && weekdayMismatch(line, found)) { warnings.push(`Page ${page} : jour de semaine contradictoire avec la date OCR, ligne non importée.`); continue; }
    const title = (inLegalHolidays && found.length === 1 ? line.slice(found[0].end) : line.slice(0, found[0].start))
      .replace(/^[\s*+»«•–—-]+/, "")
      .replace(/\b(?:du|au|de|à|le)?\s*(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s*$/i, "")
      .replace(/[|;:\s-]+$/g, "").trim();
    if (ocr && /^[a-zà-ÿ]/.test(line) && !/^[*+»«•–—-]/.test(line) && page <= 5) continue;
    const kind = inLegalHolidays && found.length === 1 ? "holiday" : kindOf(title);
    if (/^(premier|deuxieme|troisieme|second|uxieme)\s+(trimestre|semestre)\b/.test(normalize(title))) continue;
    if (!kind || title.length < 5 || /^(total|nombre|jours|observations|date|période|periode|niveau)/i.test(title)) continue;
    const startsAt = found[0].value, endsAt = found[1]?.value ?? startsAt;
    if (startsAt > endsAt || startsAt < year.startsAt.slice(0, 10) || endsAt > year.endsAt.slice(0, 10)) {
      warnings.push(`Page ${page} : date hors de l'année active ou intervalle inversé, ligne non importée.`);
      continue;
    }
    if (candidates.length >= 100) { warnings.push("Limite de 100 événements atteinte : vérifiez le reste du document manuellement."); break; }
    candidates.push({
      id: crypto.randomUUID(), title: title.slice(0, 120), kind, startsAt, endsAt,
      educationLevel: inLegalHolidays ? "Tous niveaux" : ocr ? currentLevel : level ?? currentLevel, sourcePage: page,
      suspendsCourses: false,
      uncertain: Boolean(ocr) || found.some((date) => date.ambiguous) || !(level ?? (currentLevel !== "Non déterminé" ? currentLevel : undefined)),
      status: "to-review", reviewed: false, selected: false, sourceExcerpt: line.slice(0, 500),
    });
  }
  return { pageCount, candidates, warnings, documentYear };
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
