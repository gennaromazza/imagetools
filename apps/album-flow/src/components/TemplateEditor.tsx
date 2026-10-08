import { useMemo, useRef, useState } from "react";
import type { AlbumArea, AreaTemplate, AreaStyle, FreeFrame, LayoutNode, SheetSpec, TemplateTarget } from "@photo-tools/shared-types";
import { layoutCells, type Rect } from "../engine/geometry";
import { applyShape, leaf, leafIds, removeLeaf, setRatioAt, shapeOfTree, split } from "../engine/tree";
import { TARGET_LABELS, createTemplateId, frameForAspect, restackFrames, sanitizeFrame, targetInner, type StackMove } from "../model/templates";
import { Icon } from "./icons";
import { Field, Modal, Segmented, Switch } from "./ui";

type Kind = "tree" | "free";

interface EditorFrame extends FreeFrame {
  id: string;
  /** Proporzione (larghezza / altezza) della foto che la cornice deve ospitare. */
  aspect: number;
}

const PHOTO_ASPECTS: Array<{ label: string; value: number }> = [
  { label: "3:2 orizzontale", value: 3 / 2 },
  { label: "2:3 verticale", value: 2 / 3 },
  { label: "4:3 orizzontale", value: 4 / 3 },
  { label: "3:4 verticale", value: 3 / 4 },
  { label: "1:1 quadrata", value: 1 },
  { label: "16:9 panorama", value: 16 / 9 },
];
const KNOWN_ASPECTS: Array<[number, string]> = [[1, "1:1"], [3 / 2, "3:2"], [2 / 3, "2:3"], [4 / 3, "4:3"], [3 / 4, "3:4"], [16 / 9, "16:9"], [9 / 16, "9:16"], [2, "2:1"], [1 / 2, "1:2"], [3, "3:1"]];

/** Nome della proporzione di una cella («3:2», «2:3»…) e se è quella di una foto comune. */
export function describeAspect(ratio: number): { label: string; standard: boolean } {
  const near = KNOWN_ASPECTS.find(([value]) => Math.abs(ratio / value - 1) < 0.06);
  if (near) return { label: near[1], standard: !["2:1", "1:2", "3:1", "9:16", "16:9"].includes(near[1]) };
  return { label: ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`, standard: false };
}

const uid = (() => { let n = 0; return () => `c${Date.now().toString(36)}${(n += 1)}`; })();

/** Alcune forme di partenza per i template a divisioni. */
const TREE_PRESETS: Array<{ label: string; build: () => LayoutNode }> = [
  { label: "1 foto", build: () => leaf(uid()) },
  { label: "2 colonne", build: () => split("row", 0.5, leaf(uid()), leaf(uid())) },
  { label: "2 righe", build: () => split("column", 0.5, leaf(uid()), leaf(uid())) },
  { label: "3 colonne", build: () => split("row", 1 / 3, leaf(uid()), split("row", 0.5, leaf(uid()), leaf(uid()))) },
  { label: "1 grande + 2", build: () => split("row", 0.62, leaf(uid()), split("column", 0.5, leaf(uid()), leaf(uid()))) },
  { label: "2 × 2", build: () => split("column", 0.5, split("row", 0.5, leaf(uid()), leaf(uid())), split("row", 0.5, leaf(uid()), leaf(uid()))) },
];

function freshIds(shape: LayoutNode): LayoutNode {
  return applyShape(shape, leafIds(shape).map(() => uid())) ?? shape;
}

export interface TemplateSeed {
  kind: Kind;
  target: TemplateTarget;
  shape?: LayoutNode;
  frames?: FreeFrame[];
  name?: string;
}

/** Seme di un nuovo template dal layout attuale di un'area (ad albero o libero). */
export function seedFromArea(area: AlbumArea, target: TemplateTarget): TemplateSeed | null {
  if (!area.layout || area.items.length === 0) return null;
  if (area.free && area.items.every((item) => area.free![item.id])) return { kind: "free", target, frames: area.items.map((item) => area.free![item.id]) };
  return { kind: "tree", target, shape: shapeOfTree(area.layout) };
}

/**
 * Editor dei template: si disegna una disposizione a divisioni (foto affiancate, senza sovrapposizioni) oppure libera
 * (foto che si sovrappongono, anche ruotate). Per entrambe si vedono le proporzioni di ogni foto.
 */
export function TemplateEditor({ sheet, style, initial, seed, onSave, onClose }: {
  sheet: SheetSpec;
  style: AreaStyle;
  initial?: AreaTemplate;
  seed?: TemplateSeed;
  onSave: (template: AreaTemplate) => void;
  onClose: () => void;
}) {
  const start = initial ?? seed;
  const [kind, setKind] = useState<Kind>(start?.kind ?? "tree");
  const [target, setTarget] = useState<TemplateTarget>(start?.target ?? "page");
  const [name, setName] = useState(initial?.name ?? seed?.name ?? "");
  const [tree, setTree] = useState<LayoutNode>(() => (start?.kind === "tree" && start.shape ? freshIds(start.shape) : TREE_PRESETS[4].build()));
  const [frames, setFrames] = useState<EditorFrame[]>(() => (start?.kind === "free" && start.frames ? start.frames.map((frame) => ({ ...frame, id: uid(), aspect: 1.5 })) : []));
  const [selected, setSelected] = useState<string | null>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const inner = useMemo(() => targetInner(sheet, target, 0), [sheet, target]);
  const gapMm = Math.max(0, style.gapCm * 10);
  const box: Rect = useMemo(() => ({ x: 0, y: 0, w: inner.w, h: inner.h }), [inner]);
  const layout = useMemo(() => layoutCells(tree, box, gapMm), [tree, box, gapMm]);
  const canvasRatio = inner.w / inner.h;

  const mmPerPx = () => { const rect = canvas.current?.getBoundingClientRect(); return rect && rect.width ? inner.w / rect.width : 1; };

  // ------------------------------------------------------------ divisioni
  const splitCell = (id: string, dir: "row" | "column") => {
    const replace = (node: LayoutNode): LayoutNode => node.kind === "leaf" ? (node.itemId === id ? split(dir, 0.5, leaf(id), leaf(uid())) : node) : { ...node, first: replace(node.first), second: replace(node.second) };
    setTree(replace(tree));
    setSelected(null);
  };
  const deleteCell = (id: string) => {
    const next = removeLeaf(tree, id);
    if (next) { setTree(next); setSelected(null); }
  };
  const dragDivider = (path: string, dir: "row" | "column", nodeStart: number, span: number, event: React.PointerEvent) => {
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    const base = canvas.current?.getBoundingClientRect();
    if (!base) return;
    const move = (e: PointerEvent) => {
      const position = dir === "row" ? (e.clientX - base.left) * (inner.w / base.width) : (e.clientY - base.top) * (inner.h / base.height);
      const ratio = (position - nodeStart - gapMm / 2) / Math.max(span, 1);
      setTree((current) => setRatioAt(current, path, Math.min(0.92, Math.max(0.08, ratio))));
    };
    const up = () => { element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", up); };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
  };

  // ------------------------------------------------------------ cornici libere
  const addFrame = (aspect: number) => {
    const { w, h } = frameForAspect(aspect, canvasRatio);
    const level = frames.length ? Math.max(...frames.map((frame) => frame.z)) + 1 : 0;
    const offset = (frames.length % 5) * 0.05;
    const frame: EditorFrame = { id: uid(), aspect, ...sanitizeFrame({ x: 0.1 + offset, y: 0.1 + offset, w, h, rotation: 0, z: level }) };
    setFrames([...frames, frame]);
    setSelected(frame.id);
  };
  const restack = (id: string, move: StackMove) => setFrames((current) => restackFrames(current, id, move));
  const stackAt = (id: string) => [...frames].sort((a, b) => a.z - b.z).findIndex((frame) => frame.id === id);
  const patchFrame = (id: string, change: Partial<EditorFrame>) => setFrames((current) => current.map((frame) => (frame.id === id ? { ...frame, ...change, ...sanitizeFrame({ ...frame, ...change }) } : frame)));
  const startFrameDrag = (frame: EditorFrame, mode: "move" | "resize", event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelected(frame.id);
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...frame };
    const scale = mmPerPx();
    const move = (e: PointerEvent) => {
      const dx = ((e.clientX - startX) * scale) / inner.w;
      const dy = ((e.clientY - startY) * scale) / inner.h;
      if (mode === "move") {
        let x = origin.x + dx;
        let y = origin.y + dy;
        const snap = (value: number, size: number) => [0, 0.5 - size / 2, 1 - size].reduce((best, target2) => (Math.abs(value - target2) < 0.015 ? target2 : best), value);
        x = snap(x, origin.w); y = snap(y, origin.h);
        patchFrame(origin.id, { x, y });
      } else {
        const aspectNow = (origin.w * canvasRatio) / origin.h;
        let w = Math.max(0.05, origin.w + dx);
        let h = lockAspect ? (w * canvasRatio) / aspectNow : Math.max(0.05, origin.h + dy);
        if (lockAspect && origin.y + h > 1) { h = 1 - origin.y; w = (h * aspectNow) / canvasRatio; }
        patchFrame(origin.id, { w, h });
      }
    };
    const up = () => { element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", up); };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
  };

  // ------------------------------------------------------------ salvataggio
  const count = kind === "tree" ? leafIds(tree).length : frames.length;
  const save = () => {
    const finalName = name.trim() || `${kind === "tree" ? "Divisioni" : "Libero"} · ${count} ${count === 1 ? "foto" : "foto"}`;
    if (count < 1) { setError(kind === "tree" ? "Serve almeno una cella." : "Aggiungi almeno una foto."); return; }
    const base = { id: initial?.id ?? createTemplateId(), name: finalName, target, count, createdAt: initial?.createdAt ?? new Date().toISOString() };
    if (kind === "tree") { onSave({ ...base, kind: "tree", shape: shapeOfTree(tree) }); return; }
    const ordered = [...frames].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
    const levels = [...frames].sort((a, b) => a.z - b.z).map((frame) => frame.id);
    onSave({ ...base, kind: "free", frames: ordered.map((frame) => sanitizeFrame({ x: frame.x, y: frame.y, w: frame.w, h: frame.h, rotation: frame.rotation, z: levels.indexOf(frame.id) })) });
  };

  const current = frames.find((frame) => frame.id === selected) ?? null;
  const pct = (value: number) => `${Number((value * 100).toFixed(3))}%`;

  return (
    <Modal
      title="Disegna un template"
      subtitle="Una disposizione che il programma ti riproporrà quando trova lo stesso numero di foto."
      onClose={onClose}
      wide
      footer={<>
        <span className="muted small tpl__count">{count} {count === 1 ? "foto" : "foto"} · {TARGET_LABELS[target]}</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Annulla</button>
        <button type="button" className="btn btn--primary" onClick={save}>Salva il template</button>
      </>}
    >
      <div className="tpl">
        <div className="tpl__stage">
          <div className="tpl__canvas" ref={canvas} style={{ aspectRatio: `${inner.w} / ${inner.h}` }} onPointerDown={() => setSelected(null)}>
            {kind === "tree" ? (
              <>
                {layout.cells.map((cell, index) => {
                  const info = describeAspect(cell.rect.w / cell.rect.h);
                  return (
                    <div key={cell.itemId} className={`tpl__cell${info.standard ? " is-standard" : ""}${selected === cell.itemId ? " is-selected" : ""}`}
                      style={{ left: pct(cell.rect.x / inner.w), top: pct(cell.rect.y / inner.h), width: pct(cell.rect.w / inner.w), height: pct(cell.rect.h / inner.h) }}
                      onPointerDown={(event) => { event.stopPropagation(); setSelected(cell.itemId); }}>
                      <b>{index + 1}</b><span>{info.label}</span>
                    </div>
                  );
                })}
                {layout.dividers.map((divider) => (
                  <div key={divider.path} className={`tpl__divider tpl__divider--${divider.dir}`}
                    style={divider.dir === "row"
                      ? { left: pct((divider.line.x + divider.line.w / 2) / inner.w), top: pct(divider.nodeRect.y / inner.h), height: pct(divider.nodeRect.h / inner.h) }
                      : { top: pct((divider.line.y + divider.line.h / 2) / inner.h), left: pct(divider.nodeRect.x / inner.w), width: pct(divider.nodeRect.w / inner.w) }}
                    onPointerDown={(event) => { event.stopPropagation(); dragDivider(divider.path, divider.dir, divider.start, divider.span, event); }} />
                ))}
              </>
            ) : (
              <>
                {frames.map((frame) => {
                  const info = describeAspect((frame.w * canvasRatio) / frame.h);
                  return (
                    <div key={frame.id} className={`tpl__frame${info.standard ? " is-standard" : ""}${selected === frame.id ? " is-selected" : ""}`}
                      style={{ left: pct(frame.x), top: pct(frame.y), width: pct(frame.w), height: pct(frame.h), zIndex: 2 + frame.z, transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined }}
                      onPointerDown={(event) => startFrameDrag(frame, "move", event)}>
                      <span>{info.label}</span>
                      {selected === frame.id ? <i className="tpl__handle" onPointerDown={(event) => startFrameDrag(frame, "resize", event)} /> : null}
                    </div>
                  );
                })}
                {frames.length === 0 ? <p className="tpl__hint">Aggiungi le foto con i pulsanti a destra, poi trascinale.</p> : null}
              </>
            )}
          </div>
          <p className="muted small">Le celle verdi hanno le proporzioni di una foto comune (3:2, 4:3, 1:1…): lì le foto non vengono ritagliate. Il template si adatta anche a pagine di altro formato.</p>
        </div>

        <div className="tpl__side">
          <Field label="Nome"><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Es. Grande con due appoggiate" /></Field>
          <Field label="Tipo di disposizione">
            <Segmented label="Tipo" value={kind} onChange={(value) => { setKind(value); setSelected(null); setError(null); }} options={[{ value: "tree", label: "Divisioni" }, { value: "free", label: "Libero (sovrapposte)" }]} />
          </Field>
          <Field label="Per quale area">
            <select className="select" value={target} onChange={(event) => setTarget(event.target.value as TemplateTarget)} aria-label="Per quale area">
              {(Object.keys(TARGET_LABELS) as TemplateTarget[]).map((key) => <option key={key} value={key}>{TARGET_LABELS[key]}</option>)}
            </select>
          </Field>

          {kind === "tree" ? (
            <>
              <Field label="Parti da"><div className="btn-row">{TREE_PRESETS.map((preset) => <button key={preset.label} type="button" className="chip" onClick={() => { setTree(preset.build()); setSelected(null); }}>{preset.label}</button>)}</div></Field>
              <Field label="Cella selezionata" hint={selected ? "Dividila o toglila; trascina le linee per cambiare le misure." : "Clicca una cella."}>
                <div className="btn-row">
                  <button type="button" className="btn btn--sm" disabled={!selected} onClick={() => selected && splitCell(selected, "row")}>Dividi in colonne</button>
                  <button type="button" className="btn btn--sm" disabled={!selected} onClick={() => selected && splitCell(selected, "column")}>Dividi in righe</button>
                  <button type="button" className="btn btn--sm btn--danger" disabled={!selected || leafIds(tree).length < 2} onClick={() => selected && deleteCell(selected)}>Togli</button>
                </div>
              </Field>
            </>
          ) : (
            <>
              <Field label="Aggiungi una foto"><div className="btn-row">{PHOTO_ASPECTS.map((preset) => <button key={preset.label} type="button" className="chip" onClick={() => addFrame(preset.value)}>+ {preset.label}</button>)}</div></Field>
              <Switch checked={lockAspect} onChange={setLockAspect} label="Mantieni le proporzioni quando ridimensioni" />
              <div className="tpl__frame-tools">
                <Field label={`Rotazione ${current ? `${current.rotation}°` : ""}`}>
                  <input type="range" min={-45} max={45} step={1} disabled={!current} value={current?.rotation ?? 0} onChange={(event) => current && patchFrame(current.id, { rotation: Number(event.target.value) })} aria-label="Rotazione" />
                </Field>
                <div className="btn-row">
                  <button type="button" className="btn btn--sm" disabled={!current || stackAt(current.id) === frames.length - 1} onClick={() => current && restack(current.id, "front")} title="In primo piano, sopra tutte le altre">Porta davanti</button>
                  <button type="button" className="btn btn--sm" disabled={!current || stackAt(current.id) === frames.length - 1} onClick={() => current && restack(current.id, "forward")} title="Sale di un livello">Avanti di uno</button>
                  <button type="button" className="btn btn--sm" disabled={!current || stackAt(current.id) === 0} onClick={() => current && restack(current.id, "backward")} title="Scende di un livello">Indietro di uno</button>
                  <button type="button" className="btn btn--sm" disabled={!current || stackAt(current.id) === 0} onClick={() => current && restack(current.id, "back")} title="In fondo, sotto tutte le altre">Porta dietro</button>
                  <button type="button" className="btn btn--sm" disabled={!current} onClick={() => { if (!current) return; const copy: EditorFrame = { ...current, id: uid(), x: Math.min(0.9, current.x + 0.04), y: Math.min(0.9, current.y + 0.04), z: Math.max(...frames.map((frame) => frame.z)) + 1 }; setFrames([...frames, copy]); setSelected(copy.id); }}><Icon name="copy" size={13} /> Duplica</button>
                  <button type="button" className="btn btn--sm btn--danger" disabled={!current} onClick={() => { if (!current) return; setFrames(frames.filter((frame) => frame.id !== current.id)); setSelected(null); }}>Togli</button>
                </div>
              </div>
            </>
          )}
          {error ? <p className="notice notice--warn">{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
