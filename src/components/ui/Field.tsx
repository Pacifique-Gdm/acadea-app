export function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} type={type} disabled={disabled} className="input disabled:bg-slate-100" />
    </label>
  );
}
