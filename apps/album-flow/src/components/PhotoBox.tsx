import { type CSSProperties, type ReactNode, forwardRef } from "react";
import type { Rect } from "../engine/geometry";
import { imageBox, type Placement } from "../model/placement";

const pct = (value: number) => `${Number(value.toFixed(4))}%`;

export interface PhotoBoxProps {
  /** Rettangolo (mm) del contenitore in cui si calcolano le percentuali. */
  origin: Rect;
  placement: Placement;
  src: string;
  rotation?: number;
  mono?: boolean;
  borderColor?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  alt?: string;
}

/** Una foto dentro la sua cella: cornice, bordo, area visibile e immagine (posizionata e ruotata) in percentuali del contenitore. */
export const PhotoBox = forwardRef<HTMLDivElement, PhotoBoxProps & React.HTMLAttributes<HTMLDivElement>>(function PhotoBox(
  { origin, placement, src, rotation, mono, borderColor, className = "", style, children, alt = "", ...rest },
  ref,
) {
  const { frame, content, image, borderMm } = placement;
  const box = imageBox(content, image, rotation);
  return (
    <div
      ref={ref}
      className={`cell ${className}`}
      style={{ left: pct(((frame.x - origin.x) / origin.w) * 100), top: pct(((frame.y - origin.y) / origin.h) * 100), width: pct((frame.w / origin.w) * 100), height: pct((frame.h / origin.h) * 100), ...style }}
      {...rest}
    >
      {borderMm > 0 ? <div className="cell__border" style={{ background: borderColor, left: pct(((content.x - borderMm - frame.x) / frame.w) * 100), top: pct(((content.y - borderMm - frame.y) / frame.h) * 100), width: pct(((content.w + borderMm * 2) / frame.w) * 100), height: pct(((content.h + borderMm * 2) / frame.h) * 100) }} /> : null}
      <div className="cell__content" style={{ left: pct(((content.x - frame.x) / frame.w) * 100), top: pct(((content.y - frame.y) / frame.h) * 100), width: pct((content.w / frame.w) * 100), height: pct((content.h / frame.h) * 100) }}>
        {src ? (
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={mono ? "is-mono" : undefined}
            style={{ left: pct(box.left), top: pct(box.top), width: pct(box.width), height: pct(box.height), transform: box.rotate ? `rotate(${box.rotate}deg)` : undefined }}
          />
        ) : <span className="cell__ph" />}
      </div>
      {children}
    </div>
  );
});
