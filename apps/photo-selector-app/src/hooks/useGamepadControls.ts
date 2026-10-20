import { useEffect, useRef } from "react";
import {
  createGamepadInterpreter,
  getGamepadStoreState,
  stepRating,
  type GamepadAction,
  type GamepadSnapshot,
} from "../services/gamepad-controls";

interface GamepadControlsOptions {
  previewOpen: boolean;
  /** Stelle attuali della foto su cui agiscono i comandi stella. */
  getCurrentRating: () => number | undefined;
  /** Comando «apre o chiude l'anteprima» con l'anteprima chiusa. */
  openPreview: () => void;
  onConnectionChange?: (connected: boolean, name: string) => void;
}

export function readGamepadSnapshot(pad: Gamepad): GamepadSnapshot {
  return {
    buttons: pad.buttons.map((button) => button.value || (button.pressed ? 1 : 0)),
    axes: pad.axes,
  };
}

// I gestori esistenti ignorano i tasti che arrivano da campi di testo: se il
// focus è lì (es. ricerca), l'evento parte dal body.
function resolveKeyTarget(): EventTarget {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement
    && active !== document.body
    && active.closest("input, textarea, select, [contenteditable='true']") === null
  ) {
    return active;
  }
  return document.body;
}

function dispatchKey(key: string, code: string | undefined, altKey: boolean, repeat: boolean) {
  const init: KeyboardEventInit = { key, code, altKey, repeat, bubbles: true, cancelable: true };
  resolveKeyTarget().dispatchEvent(new KeyboardEvent("keydown", init));
  resolveKeyTarget().dispatchEvent(new KeyboardEvent("keyup", init));
}

/**
 * Legge i controller collegati (Gamepad API) e li traduce nelle scorciatoie da
 * tastiera di Photo Selector. Il polling gira solo mentre un pad è collegato
 * e la finestra è visibile.
 */
export function useGamepadControls(options: GamepadControlsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return;
    }

    const interpreter = createGamepadInterpreter();
    let frame = 0;
    let activeIndex: number | null = null;

    const runAction = (action: GamepadAction) => {
      const current = optionsRef.current;
      switch (action.type) {
        case "key":
          dispatchKey(action.key, action.code, action.altKey ?? false, action.repeat ?? false);
          return;
        case "ratingStep":
          dispatchKey(String(stepRating(current.getCurrentRating(), action.delta)), undefined, false, false);
          return;
        case "togglePreview":
          if (current.previewOpen) {
            dispatchKey("Escape", "Escape", false, false);
          } else {
            current.openPreview();
          }
          return;
      }
    };

    const findPad = (): Gamepad | null => {
      const pads = navigator.getGamepads();
      if (activeIndex !== null && pads[activeIndex]?.connected) {
        return pads[activeIndex];
      }
      activeIndex = null;
      for (const pad of pads) {
        if (pad?.connected) {
          activeIndex = pad.index;
          return pad;
        }
      }
      return null;
    };

    const tick = () => {
      frame = 0;
      const pad = findPad();
      if (!pad) {
        interpreter.reset();
        return;
      }
      const { mapping, editorOpen } = getGamepadStoreState();
      // Con la finestra di mappatura aperta i pulsanti servono ad assegnare i comandi.
      if (!editorOpen && document.visibilityState === "visible" && document.hasFocus()) {
        const actions = interpreter.update(
          readGamepadSnapshot(pad),
          { previewOpen: optionsRef.current.previewOpen, mapping },
          performance.now(),
        );
        actions.forEach(runAction);
      } else {
        interpreter.reset();
      }
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(tick);
      }
    };

    const handleConnected = (event: GamepadEvent) => {
      optionsRef.current.onConnectionChange?.(true, event.gamepad.id);
      start();
    };
    const handleDisconnected = (event: GamepadEvent) => {
      optionsRef.current.onConnectionChange?.(false, event.gamepad.id);
      if (activeIndex === event.gamepad.index) {
        activeIndex = null;
        interpreter.reset();
      }
    };

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);
    // Un pad già collegato prima dell'apertura compare solo dopo la prima
    // pressione, ma se Chromium lo espone subito il polling parte qui.
    if (findPad()) {
      start();
    }

    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);
}
