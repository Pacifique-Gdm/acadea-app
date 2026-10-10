import { useLayoutEffect, useRef, useState } from "react";
import { formatMoneyInput, parseMoneyInput } from "../../utils/currency";
import { moneyInputCaret } from "../../utils/moneyInputCaret";

export function MoneyInput({ value, onChange, className = "input", placeholder = "Montant", disabled, max, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  max?: number;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<{ raw: string; position: number } | null>(null);
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    const input = inputRef.current;
    if (!pending || !input || document.activeElement !== input) return;
    const position = moneyInputCaret(pending.raw, pending.position, input.value);
    input.setSelectionRange(position, position);
    pendingCaret.current = null;
  }, [value, revision]);
  return <input
    ref={inputRef}
    value={formatMoneyInput(value)}
    onChange={(event) => {
      pendingCaret.current = { raw: event.target.value, position: event.target.selectionStart ?? event.target.value.length };
      onChange(parseMoneyInput(event.target.value));
      // Repositionne aussi le curseur quand seule une espace de regroupement
      // change : la valeur numérique normalisée peut alors rester identique.
      setRevision((current) => current + 1);
    }}
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
