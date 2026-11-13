import type { ButtonHTMLAttributes } from 'react';

/** Reserve both labels so an asynchronous response cannot move controls. */
export function AllocationActionButton({ busy = false, children, disabled, className = 'secondary-button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; children: string }) {
  return <button {...props} type="button" disabled={disabled || busy} aria-busy={busy} aria-label={busy ? 'Chargement...' : children} className={`${className} inline-grid min-h-11 shrink-0 items-center whitespace-nowrap`}>
    <span style={{ gridArea: '1 / 1', visibility: busy ? 'hidden' : 'visible' }} aria-hidden={busy}>{children}</span>
    <span style={{ gridArea: '1 / 1', visibility: busy ? 'visible' : 'hidden' }} aria-hidden={!busy}>Chargement...</span>
  </button>;
}
