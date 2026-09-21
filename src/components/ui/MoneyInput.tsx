import { formatMoneyInput, parseMoneyInput } from "../../utils/currency";

export function MoneyInput({ value, onChange, className = "input", placeholder = "Montant", disabled, max, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  max?: number;
  ariaLabel?: string;
}) {
  return <input
    value={formatMoneyInput(value)}
    onChange={(event) => onChange(parseMoneyInput(event.target.value))}
    type="text"
    inputMode="decimal"
    autoComplete="off"
    disabled={disabled}
    data-max={max}
    className={className}
    placeholder={placeholder}
    aria-label={ariaLabel}
  />;
}
