import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { hasFrame } from "../order/geometry";
import { ALL_FORMATS, customFormat, type LogoSettings, type OrderGroup } from "../order/model";

interface GroupSettingsProps {
  group: OrderGroup;
  logoUrl: string | null;
  logoSettings: LogoSettings;
  onUpdateGroup: (patch: Partial<Pick<OrderGroup, "format" | "fitMode" | "borderMm" | "logoEnabled">>) => void;
  onChooseLogo: () => void;
  onRemoveLogo: () => void;
  onUpdateLogoSettings: (patch: Partial<LogoSettings>) => void;
  onSetLogoFile: (file: File) => void;
}

const POSITIONS: Array<[LogoSettings["position"], string]> = [
  ["top-left", "In alto a sinistra"],
  ["top-right", "In alto a destra"],
  ["bottom-left", "In basso a sinistra"],
  ["bottom-right", "In basso a destra"],
  ["center", "Al centro"],
];

export function GroupSettings({ group, logoUrl, logoSettings, onUpdateGroup, onChooseLogo, onRemoveLogo, onUpdateLogoSettings, onSetLogoFile }: GroupSettingsProps) {
  const isCustom = group.format.id.startsWith("custom-");
  const framed = hasFrame(group.format);
  const [width, setWidth] = useState(String(group.format.widthCm));
  const [height, setHeight] = useState(String(group.format.heightCm));
  const [border, setBorder] = useState(String(group.borderMm));
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWidth(String(group.format.widthCm));
    setHeight(String(group.format.heightCm));
  }, [group.format]);
  useEffect(() => setBorder(String(group.borderMm)), [group.borderMm]);

  // Formato, riempimento e bordino azzerano i ritagli fatti a mano.
  const confirmChange = () => !group.photos.some((photo) => photo.crop?.reviewed)
    || window.confirm("Questa modifica azzera i ritagli fatti a mano in questo formato. Continuare?");

  const changeFormat = (id: string) => {
    const next = id === "custom" ? customFormat(10, 15) : ALL_FORMATS.find((format) => format.id === id);
    if (next && confirmChange()) onUpdateGroup({ format: next });
  };

  const commitCustom = () => {
    const w = parseFloat(width.replace(",", "."));
    const h = parseFloat(height.replace(",", "."));
    const next = w > 0 && h > 0 ? customFormat(w, h) : null;
    if (!next || next.id === group.format.id || !confirmChange()) {
      setWidth(String(group.format.widthCm));
      setHeight(String(group.format.heightCm));
      return;
    }
    onUpdateGroup({ format: next });
  };

  const commitBorder = () => {
    const value = parseFloat(border.replace(",", "."));
    if (!(value >= 0) || value === group.borderMm || !confirmChange()) {
      setBorder(String(group.borderMm));
      return;
    }
    onUpdateGroup({ borderMm: value });
  };

  const onEnter = (commit: () => void) => (event: React.KeyboardEvent) => {
    if (event.key === "Enter") commit();
  };

  const pickLogo = () => (window.filexDesktop ? onChooseLogo() : logoInput.current?.click());

  return (
    <section className="settings" aria-label="Impostazioni del formato">
      <div className="settings__row">
        <label className="field">
          <span>Formato di stampa</span>
          <select className="field__format" value={isCustom ? "custom" : group.format.id} onChange={(event) => changeFormat(event.target.value)}>
            {ALL_FORMATS.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
            <option value="custom">Misura libera…</option>
          </select>
        </label>

        {isCustom ? (
          <div className="field">
            <span>Misura in cm</span>
            <div className="field__pair">
              <input aria-label="Larghezza in cm" inputMode="decimal" value={width} onChange={(event) => setWidth(event.target.value)} onBlur={commitCustom} onKeyDown={onEnter(commitCustom)} />
              ×
              <input aria-label="Altezza in cm" inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value)} onBlur={commitCustom} onKeyDown={onEnter(commitCustom)} />
            </div>
          </div>
        ) : null}

        <div className="field">
          <span>La foto</span>
          <div className="segmented">
            {(["cover", "contain"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={group.fitMode === mode}
                onClick={() => { if (group.fitMode !== mode && confirmChange()) onUpdateGroup({ fitMode: mode }); }}
              >
                {mode === "cover" ? "Riempie il formato" : "Resta intera"}
              </button>
            ))}
          </div>
        </div>

        <label className="field" title={framed ? "La cornice della pellicola fa già da bordo." : undefined}>
          <span>Bordino bianco (mm)</span>
          <input className="field__number" type="number" min="0" step="0.5" value={framed ? 0 : border} disabled={framed} onChange={(event) => setBorder(event.target.value)} onBlur={commitBorder} onKeyDown={onEnter(commitBorder)} />
        </label>

        <label className="switch">
          <input type="checkbox" checked={group.logoEnabled} onChange={(event) => onUpdateGroup({ logoEnabled: event.target.checked })} />
          <span>Logo sulle stampe</span>
        </label>
      </div>

      {group.logoEnabled ? (
        <div className="settings__row settings__row--logo">
          <button type="button" className="btn" onClick={pickLogo}>
            <ImagePlus size={16} /> {logoUrl ? "Cambia logo" : "Scegli logo"}
          </button>
          <input
            ref={logoInput}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onSetLogoFile(file);
              event.target.value = "";
            }}
          />
          {logoUrl ? (
            <>
              <img className="settings__logo" src={logoUrl} alt="Logo scelto" />
              <label className="field">
                <span>Posizione</span>
                <select value={logoSettings.position} onChange={(event) => onUpdateLogoSettings({ position: event.target.value as LogoSettings["position"] })}>
                  {POSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Grandezza {logoSettings.scalePct}%</span>
                <input type="range" min="5" max="60" value={logoSettings.scalePct} onChange={(event) => onUpdateLogoSettings({ scalePct: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Opacità {Math.round(logoSettings.opacity * 100)}%</span>
                <input type="range" min="5" max="100" step="5" value={Math.round(logoSettings.opacity * 100)} onChange={(event) => onUpdateLogoSettings({ opacity: Number(event.target.value) / 100 })} />
              </label>
              <label className="field">
                <span>Margine {logoSettings.marginPct}%</span>
                <input type="range" min="0" max="20" value={logoSettings.marginPct} onChange={(event) => onUpdateLogoSettings({ marginPct: Number(event.target.value) })} />
              </label>
              <button type="button" className="btn btn--ghost" onClick={onRemoveLogo}>Rimuovi logo</button>
            </>
          ) : <span className="hint">Un solo logo per tutto il lavoro; lo accendi formato per formato.</span>}
        </div>
      ) : null}
    </section>
  );
}
