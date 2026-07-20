const appEnvironment = import.meta.env.VITE_APP_ENV ?? "development";

const showStagingBanner = import.meta.env.VITE_STAGING_BANNER === "true" || appEnvironment === "staging" || appEnvironment === "preview";
const stagingLabel = import.meta.env.VITE_STAGING_LABEL ?? "ENVIRONNEMENT DE TEST";

export function EnvironmentBanner() {
  if (!showStagingBanner) return null;

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-[70] bg-amber-500 px-3 py-2 text-center text-xs font-extrabold uppercase tracking-wide text-ink shadow-sm sm:text-sm">
        {stagingLabel}
      </div>
      <div className="h-9 sm:h-10" />
    </>
  );
}
