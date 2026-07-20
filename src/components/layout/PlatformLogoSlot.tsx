import { useEffect, useState } from "react";

export function PlatformLogoSlot({ logoUrl, compact = false }: { logoUrl: string; compact?: boolean }) {
  const [logoShape, setLogoShape] = useState<"horizontal" | "vertical" | "balanced">("balanced");
  useEffect(() => {
    setLogoShape("balanced");
  }, [logoUrl]);
  const logoSource = logoUrl || "/acadea-icon.png";

  const containerClass =
    logoShape === "horizontal"
      ? compact
        ? "max-w-[220px] min-h-14"
        : "max-w-[320px] min-h-[72px] sm:max-w-[380px] sm:min-h-[88px]"
      : logoShape === "vertical"
        ? compact
          ? "max-w-[120px] min-h-20"
          : "max-w-[150px] min-h-[112px] sm:max-w-[180px] sm:min-h-[136px]"
        : compact
          ? "max-w-[150px] min-h-16"
          : "max-w-[210px] min-h-[88px] sm:max-w-[240px] sm:min-h-[108px]";
  const imageClass =
    logoShape === "horizontal"
      ? compact
        ? "max-h-14"
        : "max-h-20 sm:max-h-24"
      : logoShape === "vertical"
        ? compact
          ? "max-h-20"
          : "max-h-32 sm:max-h-40"
        : compact
          ? "max-h-16"
          : "max-h-24 sm:max-h-28";

  return (
    <div
      className={`mx-auto flex w-full items-center justify-center ${compact ? "mb-4" : ""} ${containerClass}`}
    >
      <img
        src={logoSource}
        alt="Logo de l'application"
        className={`h-auto w-auto max-w-full object-contain drop-shadow-[0_14px_28px_rgba(15,23,42,0.10)] ${imageClass}`}
        decoding="async"
        onError={(event) => {
          const image = event.currentTarget;
          if (image.src.endsWith("/acadea-icon.png")) return;
          image.src = "/acadea-icon.png";
        }}
        onLoad={(event) => {
          const image = event.currentTarget;
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          if (!width || !height) return;
          const ratio = width / height;
          setLogoShape(ratio >= 1.45 ? "horizontal" : ratio <= 0.72 ? "vertical" : "balanced");
        }}
      />
    </div>
  );
}
