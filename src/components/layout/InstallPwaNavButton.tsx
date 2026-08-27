export function InstallPwaNavButton({ onInstall }: { onInstall: () => void }) {
  return (
    <button
      onClick={onInstall}
      className="mobile-bottom-navigation__item text-mint hover:bg-mint/10 hover:text-mint"
      type="button"
    >
      <span className="text-lg leading-none" aria-hidden="true">📲</span>
      <span className="mobile-bottom-navigation__label">Installer Acadéa</span>
    </button>
  );
}
