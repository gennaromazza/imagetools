import type { CSSProperties, PointerEventHandler, RefObject } from "react";
import { contentSpec, cropFor, displayedSize, effectiveBorderMm, hasFrame, orientedSizeCm } from "../order/geometry";
import type { LogoSettings, OrderGroup, OrderPhoto } from "../order/model";
import { getPhotoContentRectCm } from "../print-engine";

interface CropViewProps {
  group: OrderGroup;
  photo: OrderPhoto;
  url: string | null;
  logo: LogoSettings;
  logoUrl: string | null;
  boxRef?: RefObject<HTMLDivElement | null>;
  windowRef?: RefObject<HTMLDivElement | null>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
}

/** Anteprima in puro CSS con la stessa geometria di renderPrint. */
export function CropView({ group, photo, url, logo, logoUrl, boxRef, windowRef, onPointerDown, onPointerMove, onPointerUp }: CropViewProps) {
  const paper = orientedSizeCm(group.format, displayedSize(photo));
  const content = getPhotoContentRectCm(contentSpec(group, photo));
  // Con la cornice la finestra è quella della pellicola; altrimenti è il foglio meno il bordino.
  const border = effectiveBorderMm(group) / 10;
  const offset = hasFrame(group.format) ? content : { x: border, y: border };

  const crop = cropFor(group, photo);
  const aspect = content.width / content.height;
  const sourceAspect = (crop.cropWidth * photo.width) / (crop.cropHeight * photo.height);
  const angle = (crop.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const scales = [aspect / (sourceAspect * cos + sin), 1 / (sourceAspect * sin + cos)];
  const drawHeight = group.fitMode === "cover" ? Math.max(...scales) : Math.min(...scales);

  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  const paperRatio = paper.widthCm / paper.heightCm;
  const [vertical, horizontal] = logo.position.split("-");
  const margin = `${logo.marginPct}cqmin`;
  const logoStyle: CSSProperties = logo.position === "center"
    ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
    : { [vertical]: margin, [horizontal]: margin };

  return (
    <div className="crop-container">
      <div
        className="crop-paper"
        style={{ aspectRatio: `${paperRatio}`, width: `min(100cqw, calc(100cqh * ${paperRatio}))` }}
      >
        <div
          className="crop-window"
          style={{
            left: percent(offset.x, paper.widthCm),
            top: percent(offset.y, paper.heightCm),
            width: percent(content.width, paper.widthCm),
            height: percent(content.height, paper.heightCm),
          }}
          ref={windowRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url ? (
            <div
              ref={boxRef}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: percent(drawHeight * sourceAspect, aspect),
                height: `${drawHeight * 100}%`,
                transform: `translate(-50%, -50%) rotate(${crop.rotation}deg)`,
                overflow: "hidden",
              }}
            >
              <img
                src={url}
                alt={photo.fileName}
                loading="lazy"
                draggable={false}
                style={{
                  position: "absolute",
                  maxWidth: "none",
                  pointerEvents: "none",
                  width: `${100 / crop.cropWidth}%`,
                  height: `${100 / crop.cropHeight}%`,
                  left: `${-(crop.cropLeft / crop.cropWidth) * 100}%`,
                  top: `${-(crop.cropTop / crop.cropHeight) * 100}%`,
                }}
              />
            </div>
          ) : null}
          {group.logoEnabled && logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              style={{
                position: "absolute",
                width: `${logo.scalePct}cqmin`,
                opacity: logo.opacity,
                pointerEvents: "none",
                ...logoStyle,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
