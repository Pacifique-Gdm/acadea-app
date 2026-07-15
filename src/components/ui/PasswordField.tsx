import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible?: boolean;
  onToggle?: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [internalVisible, setInternalVisible] = useState(false);
  const isVisible = visible ?? internalVisible;
  const toggleVisibility = onToggle ?? (() => setInternalVisible((current) => !current));

  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
      {label}
      <span className="relative min-w-0">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={isVisible ? "text" : "password"}
          disabled={disabled}
          className="input pr-10 disabled:bg-slate-100"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={toggleVisibility}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          aria-label={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          title={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        >
          {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}
