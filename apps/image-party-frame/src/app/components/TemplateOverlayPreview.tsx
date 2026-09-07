import { useEffect, useState } from "react";
import { getCustomTemplateLogoFile, type CustomTemplateVariant, type TemplateLogoOverlay } from "../contexts/ProjectContext";
import { TemplateTextPreview } from "./TemplateTextPreview";

function LogoPreview({ logo, orientation }: { logo: TemplateLogoOverlay; orientation: "vertical" | "horizontal" }) {
  const file = getCustomTemplateLogoFile(orientation, logo.id);
  const [source, setSource] = useState(logo.previewUrl ?? "");
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setSource(url);
      return () => URL.revokeObjectURL(url);
    }
    setSource(logo.previewUrl ?? "");
  }, [file, logo.previewUrl]);
  return source ? <img src={source} alt={logo.fileName || "Logo template"} className="w-full h-full object-contain" draggable={false} />
    : <span role="alert">Logo non disponibile: {logo.fileName || "ricarica il template"}</span>;
}

/** The live photo preview has its own composition, separate from the processed image. */
export function TemplateOverlayPreview({ variant, orientation }: { variant: CustomTemplateVariant; orientation: "vertical" | "horizontal" }) {
  return <div data-testid="project-template-overlays" data-orientation={orientation} className="absolute inset-0 overflow-hidden pointer-events-none z-10">
    {(variant.logos ?? []).map((logo) => <div key={logo.id} data-testid="project-logo" className="absolute"
      style={{ left: `${logo.x / variant.widthPx * 100}%`, top: `${logo.y / variant.heightPx * 100}%`,
        width: `${logo.width / variant.widthPx * 100}%`, height: `${logo.height / variant.heightPx * 100}%`, opacity: logo.opacity / 100 }}>
      <LogoPreview logo={logo} orientation={orientation} />
    </div>)}
    {(variant.texts ?? []).map((text) => <div key={text.id} data-testid="project-text" className="absolute"
      style={{ left: `${text.x / variant.widthPx * 100}%`, top: `${text.y / variant.heightPx * 100}%`, width: `${text.width / variant.widthPx * 100}%`, opacity: text.opacity / 100 }}>
      <TemplateTextPreview text={text} maxHeight={variant.heightPx - text.y} />
    </div>)}
  </div>;
}
