// Interprete dei controller di gioco (pad stile Xbox 360 o generici) per la
// selezione delle foto. Trasforma lo stato grezzo dei pulsanti in azioni che
// riusano le scorciatoie da tastiera già esistenti, così griglia e anteprima
// si comportano esattamente come con la tastiera.
//
// I pulsanti predefiniti seguono il layout "standard" della Gamepad API (W3C),
// che Chromium applica ai pad XInput e alla maggior parte dei pad generici.
// Ogni comando può essere riassegnato: la mappatura vale per questo PC.

export const GAMEPAD_BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  leftStick: 10,
  rightStick: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

const STANDARD_BUTTON_NAMES: readonly string[] = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back / View", "Start / Menu",
  "Levetta sinistra (pressione)", "Levetta destra (pressione)",
  "Croce su", "Croce giù", "Croce sinistra", "Croce destra", "Guide / Home",
];

export type GamepadCommand =
  | "moveUp"
  | "moveDown"
  | "moveLeft"
  | "moveRight"
  | "previous"
  | "next"
  | "pick"
  | "reject"
  | "neutral"
  | "ratingDown"
  | "ratingUp"
  | "zoom"
  | "togglePreview"
  | "closePreview";

/** Pulsante assegnato a ogni comando (indice della Gamepad API) o nessuno. */
export type GamepadMapping = Record<GamepadCommand, number | null>;

export const GAMEPAD_COMMANDS: readonly { command: GamepadCommand; label: string }[] = [
  { command: "moveUp", label: "Sposta in su" },
  { command: "moveDown", label: "Sposta in giù" },
  { command: "moveLeft", label: "Sposta a sinistra" },
  { command: "moveRight", label: "Sposta a destra" },
  { command: "previous", label: "Foto precedente" },
  { command: "next", label: "Foto successiva" },
  { command: "pick", label: "Pick" },
  { command: "reject", label: "Scartata" },
  { command: "neutral", label: "Neutra" },
  { command: "ratingDown", label: "Una stella in meno" },
  { command: "ratingUp", label: "Una stella in più" },
  { command: "zoom", label: "Zoom" },
  { command: "togglePreview", label: "Apre o chiude l’anteprima grande" },
  { command: "closePreview", label: "Chiude l’anteprima" },
];

export const DEFAULT_GAMEPAD_MAPPING: Readonly<GamepadMapping> = {
  moveUp: GAMEPAD_BUTTON.dpadUp,
  moveDown: GAMEPAD_BUTTON.dpadDown,
  moveLeft: GAMEPAD_BUTTON.dpadLeft,
  moveRight: GAMEPAD_BUTTON.dpadRight,
  previous: GAMEPAD_BUTTON.lt,
  next: GAMEPAD_BUTTON.rt,
  pick: GAMEPAD_BUTTON.a,
  reject: GAMEPAD_BUTTON.x,
  neutral: GAMEPAD_BUTTON.back,
  ratingDown: GAMEPAD_BUTTON.lb,
  ratingUp: GAMEPAD_BUTTON.rb,
  zoom: GAMEPAD_BUTTON.y,
  togglePreview: GAMEPAD_BUTTON.start,
  closePreview: GAMEPAD_BUTTON.b,
};

/** Comandi che, tenuti premuti, si ripetono come un tasto della tastiera. */
const REPEATING_COMMANDS: ReadonlySet<GamepadCommand> = new Set([
  "moveUp", "moveDown", "moveLeft", "moveRight", "previous", "next",
]);

const MAX_BUTTON_INDEX = 63;

export function gamepadButtonName(index: number | null, standardLayout = true): string {
  if (index === null) {
    return "Nessuno";
  }
  return (standardLayout ? STANDARD_BUTTON_NAMES[index] : undefined) ?? `Pulsante ${index + 1}`;
}

/** Ricostruisce una mappatura valida da dati salvati, scartando valori estranei. */
export function normalizeGamepadMapping(value: unknown): GamepadMapping {
  const mapping: GamepadMapping = { ...DEFAULT_GAMEPAD_MAPPING };
  if (!value || typeof value !== "object") {
    return mapping;
  }
  const used = new Set<number>();
  for (const { command } of GAMEPAD_COMMANDS) {
    const raw = (value as Record<string, unknown>)[command];
    if (raw === null) {
      mapping[command] = null;
    } else if (Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) <= MAX_BUTTON_INDEX && !used.has(raw as number)) {
      mapping[command] = raw as number;
    }
    const assigned = mapping[command];
    if (assigned !== null) {
      if (used.has(assigned)) {
        mapping[command] = null;
      } else {
        used.add(assigned);
      }
    }
  }
  return mapping;
}

/**
 * Assegna un pulsante a un comando. Un pulsante comanda una sola azione: se era
 * già usato altrove, l'altro comando resta senza pulsante.
 */
export function assignGamepadButton(
  mapping: GamepadMapping,
  command: GamepadCommand,
  button: number | null,
): GamepadMapping {
  const next: GamepadMapping = { ...mapping };
  if (button !== null) {
    for (const { command: other } of GAMEPAD_COMMANDS) {
      if (next[other] === button) {
        next[other] = null;
      }
    }
  }
  next[command] = button;
  return next;
}

export function describeGamepadMapping(mapping: GamepadMapping): { control: string; description: string }[] {
  const entries = GAMEPAD_COMMANDS
    .filter(({ command }) => mapping[command] !== null)
    .map(({ command, label }) => ({ control: gamepadButtonName(mapping[command]), description: label }));
  return [
    ...entries,
    { control: "Levetta sinistra", description: "Sposta la foto attiva (sempre attiva)" },
    { control: "Levetta destra", description: "Sposta la foto ingrandita in anteprima" },
  ];
}

// ── Salvataggio su questo PC ──

const STORAGE_KEY = "filex.photoSelector.gamepadMapping";

export interface GamepadStoreState {
  mapping: GamepadMapping;
  editorOpen: boolean;
}

let storeState: GamepadStoreState | null = null;
const storeListeners = new Set<() => void>();

function readStoredMapping(): GamepadMapping {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    return normalizeGamepadMapping(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_GAMEPAD_MAPPING };
  }
}

export function getGamepadStoreState(): GamepadStoreState {
  if (!storeState) {
    storeState = { mapping: readStoredMapping(), editorOpen: false };
  }
  return storeState;
}

export function subscribeGamepadStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

function setStoreState(next: GamepadStoreState) {
  storeState = next;
  for (const listener of Array.from(storeListeners)) {
    listener();
  }
}

export function saveGamepadMapping(mapping: GamepadMapping): void {
  const normalized = normalizeGamepadMapping(mapping);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Archivio non disponibile: la mappatura resta valida fino alla chiusura.
  }
  setStoreState({ ...getGamepadStoreState(), mapping: normalized });
}

export function setGamepadMappingEditorOpen(editorOpen: boolean): void {
  setStoreState({ ...getGamepadStoreState(), editorOpen });
}

// ── Interprete ──

export interface GamepadSnapshot {
  /** Valore analogico 0..1 di ogni pulsante (i digitali valgono 0 o 1). */
  buttons: readonly number[];
  axes: readonly number[];
}

export interface GamepadContext {
  previewOpen: boolean;
  mapping?: GamepadMapping;
}

export type GamepadAction =
  | { type: "key"; key: string; code?: string; altKey?: boolean; repeat?: boolean }
  | { type: "togglePreview" }
  | { type: "ratingStep"; delta: 1 | -1 };

const PRESS_THRESHOLD = 0.5;
const STICK_DEADZONE = 0.55;
const REPEAT_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 120;
const PAN_INTERVAL_MS = 60;

type Direction = "up" | "down" | "left" | "right";

const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

const ARROW_BY_DIRECTION: Record<Direction, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

const MOVE_COMMAND_BY_DIRECTION: Record<Direction, GamepadCommand> = {
  up: "moveUp",
  down: "moveDown",
  left: "moveLeft",
  right: "moveRight",
};

function arrowKey(key: string, repeat: boolean): GamepadAction {
  return { type: "key", key, code: key, repeat };
}

function actionForCommand(command: GamepadCommand, repeat: boolean, context: GamepadContext): GamepadAction | null {
  switch (command) {
    case "moveUp": return arrowKey("ArrowUp", repeat);
    case "moveDown": return arrowKey("ArrowDown", repeat);
    case "moveLeft": return arrowKey("ArrowLeft", repeat);
    case "moveRight": return arrowKey("ArrowRight", repeat);
    case "previous": return arrowKey("ArrowLeft", repeat);
    case "next": return arrowKey("ArrowRight", repeat);
    case "pick": return { type: "key", key: "p", code: "KeyP" };
    case "reject": return { type: "key", key: "x", code: "KeyX" };
    case "neutral": return { type: "key", key: "u", code: "KeyU" };
    case "zoom": return { type: "key", key: "z", code: "KeyZ" };
    case "ratingDown": return { type: "ratingStep", delta: -1 };
    case "ratingUp": return { type: "ratingStep", delta: 1 };
    case "togglePreview": return { type: "togglePreview" };
    case "closePreview": return context.previewOpen ? { type: "key", key: "Escape", code: "Escape" } : null;
  }
}

function isPressed(snapshot: GamepadSnapshot, index: number | null): boolean {
  return index !== null && (snapshot.buttons[index] ?? 0) >= PRESS_THRESHOLD;
}

function readStickDirection(x: number, y: number): Direction | null {
  if (Math.abs(x) < STICK_DEADZONE && Math.abs(y) < STICK_DEADZONE) {
    return null;
  }
  if (Math.abs(x) >= Math.abs(y)) {
    return x > 0 ? "right" : "left";
  }
  return y > 0 ? "down" : "up";
}

/** Primo pulsante premuto ora e non nello snapshot precedente (per la mappatura). */
export function findNewlyPressedButton(previous: GamepadSnapshot | null, current: GamepadSnapshot): number | null {
  for (let index = 0; index < current.buttons.length; index += 1) {
    if (isPressed(current, index) && !(previous && isPressed(previous, index))) {
      return index;
    }
  }
  return null;
}

interface HeldControl {
  since: number;
  lastFired: number;
}

/**
 * Crea un interprete con stato: va chiamato a ogni frame con lo snapshot del
 * pad e restituisce le azioni da eseguire. Le pressioni singole scattano sul
 * fronte di salita; spostamenti e scorrimento ripetono dopo una breve attesa,
 * come un tasto tenuto premuto.
 */
export function createGamepadInterpreter() {
  let previousSnapshot: GamepadSnapshot | null = null;
  const held = new Map<string, HeldControl>();

  const fireHeld = (
    id: string,
    active: boolean,
    now: number,
    delay: number,
    interval: number,
    action: (repeat: boolean) => GamepadAction | null,
    out: GamepadAction[],
  ) => {
    const current = held.get(id);
    if (!active) {
      held.delete(id);
      return;
    }
    let fired: GamepadAction | null = null;
    if (!current) {
      held.set(id, { since: now, lastFired: now });
      fired = action(false);
    } else if (now - current.since >= delay && now - current.lastFired >= interval) {
      current.lastFired = now;
      fired = action(true);
    }
    if (fired) {
      out.push(fired);
    }
  };

  return {
    reset() {
      previousSnapshot = null;
      held.clear();
    },

    update(snapshot: GamepadSnapshot, context: GamepadContext, now: number): GamepadAction[] {
      const out: GamepadAction[] = [];
      const mapping = context.mapping ?? DEFAULT_GAMEPAD_MAPPING;
      const previous = previousSnapshot;

      // La levetta sinistra muove sempre, in aggiunta ai pulsanti assegnati.
      const stickDirection = readStickDirection(snapshot.axes[0] ?? 0, snapshot.axes[1] ?? 0);
      let buttonDirection: Direction | null = null;
      for (const direction of DIRECTIONS) {
        if (isPressed(snapshot, mapping[MOVE_COMMAND_BY_DIRECTION[direction]])) {
          buttonDirection = direction;
          break;
        }
      }
      const direction = buttonDirection ?? stickDirection;

      for (const { command } of GAMEPAD_COMMANDS) {
        if (REPEATING_COMMANDS.has(command)) {
          const moveDirection = DIRECTIONS.find((candidate) => MOVE_COMMAND_BY_DIRECTION[candidate] === command);
          const active = moveDirection ? direction === moveDirection : isPressed(snapshot, mapping[command]);
          fireHeld(command, active, now, REPEAT_DELAY_MS, REPEAT_INTERVAL_MS,
            (repeat) => actionForCommand(command, repeat, context), out);
          continue;
        }
        const button = mapping[command];
        if (isPressed(snapshot, button) && !(previous && isPressed(previous, button))) {
          const action = actionForCommand(command, false, context);
          if (action) {
            out.push(action);
          }
        }
      }

      // Levetta destra: spostamento della foto ingrandita (solo in anteprima).
      // Come la tastiera: ↑/↓ e Alt+←/→ mostrano la parte verso cui si spinge.
      const panDirection = context.previewOpen
        ? readStickDirection(snapshot.axes[2] ?? 0, snapshot.axes[3] ?? 0)
        : null;
      for (const candidate of DIRECTIONS) {
        const key = ARROW_BY_DIRECTION[candidate];
        const altKey = candidate === "left" || candidate === "right";
        fireHeld(`pan-${candidate}`, panDirection === candidate, now, 0, PAN_INTERVAL_MS,
          (repeat) => ({ type: "key", key, code: key, altKey, repeat }), out);
      }

      previousSnapshot = snapshot;
      return out;
    },
  };
}

/** Stelle risultanti da un passo LB/RB, sempre nell'intervallo 0..5. */
export function stepRating(current: number | undefined, delta: 1 | -1): number {
  const base = Number.isFinite(current) ? Math.round(current as number) : 0;
  return Math.min(5, Math.max(0, base + delta));
}
