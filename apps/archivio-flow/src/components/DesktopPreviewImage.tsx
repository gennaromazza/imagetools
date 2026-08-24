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
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const isVideo = /\.(mp4|mov|m4v|avi|mkv|mts|m2ts|mpg|mpeg|3gp|webm)$/i.test(filePath);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setSrc(null);
    setStatus("loading");

    void getArchivioPreviewImageUrl(sdPath, filePath)
      .then((nextUrl) => {
        if (!alive || !nextUrl) return;
        objectUrl = nextUrl;
        setSrc(nextUrl);
        setStatus("ready");
      })
      .catch(() => {
        if (alive) {
          setSrc(null);
          setStatus("error");
        }
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
        {status === "error" ? "Anteprima non disponibile" : (
          <span className="media-preview-loading">
            <span className="media-preview-loading__spinner" aria-hidden="true" />
            {isVideo ? "Genero miniatura video…" : "Carico anteprima foto…"}
          </span>
        )}
      </div>
    );
  }

  return <img src={src} alt={alt} style={style} loading="lazy" />;
}
