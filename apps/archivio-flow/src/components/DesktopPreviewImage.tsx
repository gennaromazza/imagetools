import { useEffect, useState } from "react";
import { getArchivioPreviewImageUrl } from "../archivioDesktopApi";

interface Props {
  sdPath: string;
  filePath: string;
  alt: string;
  style?: React.CSSProperties;
}

export function DesktopPreviewImage({ sdPath, filePath, alt, style }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;

    void getArchivioPreviewImageUrl(sdPath, filePath)
      .then((nextUrl) => {
        if (!alive || !nextUrl) return;
        objectUrl = nextUrl;
        setSrc(nextUrl);
      })
      .catch(() => {
        if (alive) setSrc(null);
      });

    return () => {
      alive = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [filePath, sdPath]);

  if (!src) {
    return (
      <div
        style={{
          width: "100%",
          height: 90,
          borderRadius: 7,
          marginBottom: "0.35rem",
          background: "rgba(255,255,255,0.05)",
          display: "grid",
          placeItems: "center",
          color: "var(--text-muted)",
          fontSize: "0.8rem",
          ...style,
        }}
      >
        Anteprima
      </div>
    );
  }

  return <img src={src} alt={alt} style={style} loading="lazy" />;
}
