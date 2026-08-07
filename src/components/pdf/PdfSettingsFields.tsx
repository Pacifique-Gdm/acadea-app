import type { PdfGenerationSettings } from "../../utils/pdfSettings";
import { PDF_FONT_FAMILIES, PDF_FONT_SIZES, PDF_LINE_SPACINGS, PDF_PAGE_SIZES, storePdfSettings } from "../../utils/pdfSettings";

export function PdfSettingsFields({ value, onChange, disabled = false }: {
  value: PdfGenerationSettings;
  onChange: (settings: PdfGenerationSettings) => void;
  disabled?: boolean;
}) {
  const update = <K extends keyof PdfGenerationSettings>(key: K, next: PdfGenerationSettings[K]) => {
    const settings = { ...value, [key]: next };
    storePdfSettings(settings);
    onChange(settings);
  };
  return <section className="grid gap-3 rounded-lg border bg-white p-4">
    <h3 className="font-semibold uppercase text-slate-800">Mise en forme du PDF</h3>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <PdfSelect label="Police" value={value.fontFamily} disabled={disabled} onChange={(next) => update("fontFamily", next as PdfGenerationSettings["fontFamily"])} options={PDF_FONT_FAMILIES.map((item) => [item, item])} />
      <PdfSelect label="Taille du texte" value={String(value.fontSize)} disabled={disabled} onChange={(next) => update("fontSize", Number(next) as PdfGenerationSettings["fontSize"])} options={PDF_FONT_SIZES.map((item) => [String(item), `${item} pt`])} />
      <PdfSelect label="Interligne" value={String(value.lineSpacing)} disabled={disabled} onChange={(next) => update("lineSpacing", Number(next) as PdfGenerationSettings["lineSpacing"])} options={PDF_LINE_SPACINGS.map((item) => [String(item), String(item).replace(".", ",")])} />
      <PdfSelect label="Format de page" value={value.pageSize} disabled={disabled} onChange={(next) => update("pageSize", next as PdfGenerationSettings["pageSize"])} options={PDF_PAGE_SIZES.map((item) => [item, item === "LETTER" ? "Lettre" : item])} />
    </div>
    <p className="text-xs text-slate-500">Police : {value.fontFamily} — Taille : {value.fontSize} pt — Interligne : {String(value.lineSpacing).replace(".", ",")} — Format : {value.pageSize === "LETTER" ? "Lettre" : value.pageSize}</p>
  </section>;
}

function PdfSelect({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[]; disabled: boolean }) {
  return <label className="grid min-w-0 gap-1 text-sm"><span>{label}</span><select className="input w-full" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map(([option, caption]) => <option key={option} value={option}>{caption}</option>)}</select></label>;
}
