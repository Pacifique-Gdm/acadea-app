export function InstallPwaNavButton({ onInstall }: { onInstall: () => void }) {
  return (
    <button
      onClick={onInstall}
      className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-2 text-[10px] font-semibold text-mint transition hover:bg-mint/10 hover:text-mint min-[360px]:text-[11px] sm:px-1 sm:text-xs"
      type="button"
    >
      <span className="text-lg leading-none" aria-hidden="true">📲</span>
      <span className="max-w-full truncate">Installer Acadéa</span>
    </button>
  );
}
