import { useEffect, useState } from "react";
import { getArchivioPreviewImageUrl, hasArchivioPreviewCached } from "../archivioDesktopApi";

/** Attesa prima di chiedere una miniatura non in cache: scorrendo veloce le celle che passano non fanno nessuna lettura dalla SD. */
const PREVIEW_SETTLE_MS = 90;

interface Props {
  sdPath: string;
  filePath: string;
  sourceFileKey?: string;
  alt: string;
  style?: React.CSSProperties;
}

export function DesktopPreviewImage({ sdPath, filePath, sourceFileKey, alt, style }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const isVideo = /\.(mp4|mov|m4v|avi|mkv|mts|m2ts|mpg|mpeg|3gp|webm)$/i.test(filePath);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setSrc(null);
    setStatus("loading");

    const start = () => void getArchivioPreviewImageUrl(sdPath, filePath, sourceFileKey, controller.signal)
      .then((nextUrl) => {
        if (!alive) { if (nextUrl) URL.revokeObjectURL(nextUrl); return; }
        if (!nextUrl) { setStatus("error"); return; }
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

    const timer = hasArchivioPreviewCached(sdPath, filePath, sourceFileKey) ? null : setTimeout(start, PREVIEW_SETTLE_MS);
    if (timer === null) start();

    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [filePath, sdPath, sourceFileKey]);

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

  return <img src={src} alt={alt} style={style} decoding="async" />;
}
