import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  assignGamepadButton,
  DEFAULT_GAMEPAD_MAPPING,
  findNewlyPressedButton,
  GAMEPAD_COMMANDS,
  gamepadButtonName,
  getGamepadStoreState,
  saveGamepadMapping,
  setGamepadMappingEditorOpen,
  subscribeGamepadStore,
  type GamepadCommand,
  type GamepadSnapshot,
} from "../services/gamepad-controls";
import { readGamepadSnapshot } from "../hooks/useGamepadControls";

export function useGamepadStore() {
  return useSyncExternalStore(subscribeGamepadStore, getGamepadStoreState, getGamepadStoreState);
}

interface ConnectedPad {
  name: string;
  standardLayout: boolean;
}

function firstConnectedPad(): Gamepad | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return null;
  }
  return navigator.getGamepads().find((pad): pad is Gamepad => Boolean(pad?.connected)) ?? null;
}

/** Scheda «Controller» delle impostazioni: stato del pad, mappatura attuale e accesso alla finestra di assegnazione. */
export function GamepadSettingsSection() {
  const { mapping } = useGamepadStore();
  const [pad, setPad] = useState<ConnectedPad | null>(() => {
    const current = firstConnectedPad();
    return current ? { name: current.id, standardLayout: current.mapping === "standard" } : null;
  });

  useEffect(() => {
    const refresh = () => {
      const current = firstConnectedPad();
      setPad(current ? { name: current.id, standardLayout: current.mapping === "standard" } : null);
    };
    window.addEventListener("gamepadconnected", refresh);
    window.addEventListener("gamepaddisconnected", refresh);
    return () => {
      window.removeEventListener("gamepadconnected", refresh);
      window.removeEventListener("gamepaddisconnected", refresh);
    };
  }, []);

  const standardLayout = pad?.standardLayout ?? true;

  return (
    <>
      <p className="photo-selector__settings-empty">
        {pad
          ? `Collegato: ${pad.name}`
          : "Nessun controller rilevato: collegalo e premi un pulsante qualsiasi."}
      </p>
      <ul className="photo-selector__settings-gamepad-list">
        {GAMEPAD_COMMANDS.map(({ command, label }) => (
          <li key={command}>
            <span>{label}</span>
            <kbd className="shortcut-help__kbd">{gamepadButtonName(mapping[command], standardLayout)}</kbd>
          </li>
        ))}
      </ul>
      <p className="photo-selector__settings-empty">
        La levetta sinistra sposta sempre la foto attiva; la destra sposta la foto ingrandita in anteprima.
      </p>
      <button type="button" className="ghost-button ghost-button--small" onClick={() => setGamepadMappingEditorOpen(true)}>
        Personalizza pulsanti…
      </button>
    </>
  );
}

/**
 * Finestra per riassegnare i pulsanti del controller: si sceglie un comando,
 * si preme il pulsante sul pad e la mappatura viene salvata su questo PC.
 */
export function GamepadMappingModal() {
  const { mapping } = useGamepadStore();
  const [listeningFor, setListeningFor] = useState<GamepadCommand | null>(null);
  const [pad, setPad] = useState<ConnectedPad | null>(null);
  const [pressedButtons, setPressedButtons] = useState<number[]>([]);
  const listeningRef = useRef(listeningFor);
  listeningRef.current = listeningFor;
  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;

  const close = () => setGamepadMappingEditorOpen(false);

  useEffect(() => {
    let frame = 0;
    let previous: GamepadSnapshot | null = null;
    let lastPadKey = "";
    let lastPressedKey = "";

    const tick = () => {
      const current = firstConnectedPad();
      const padKey = current ? `${current.id}|${current.mapping}` : "";
      if (padKey !== lastPadKey) {
        lastPadKey = padKey;
        setPad(current ? { name: current.id, standardLayout: current.mapping === "standard" } : null);
        previous = null;
      }
      if (current) {
        const snapshot = readGamepadSnapshot(current);
        const pressed = snapshot.buttons.flatMap((value, index) => (value >= 0.5 ? [index] : []));
        const pressedKey = pressed.join(",");
        if (pressedKey !== lastPressedKey) {
          lastPressedKey = pressedKey;
          setPressedButtons(pressed);
        }
        // Il primo frame serve da riferimento: un pulsante già tenuto premuto
        // quando si clicca «Assegna» non viene preso per errore.
        const command = listeningRef.current;
        if (command && previous) {
          const button = findNewlyPressedButton(previous, snapshot);
          if (button !== null) {
            saveGamepadMapping(assignGamepadButton(mappingRef.current, command, button));
            setListeningFor(null);
          }
        }
        previous = snapshot;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (listeningRef.current) {
        setListeningFor(null);
      } else {
        close();
      }
    };
    // In cattura, così Esc non chiude anche l'anteprima sottostante.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const standardLayout = pad?.standardLayout ?? true;

  return (
    <div className="modal-backdrop gamepad-mapping" onClick={close}>
      <div
        className="modal-panel gamepad-mapping__panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gamepad-mapping-title"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="gamepad-mapping-title">Pulsanti del controller</h2>
            <p>
              {pad
                ? `Collegato: ${pad.name}`
                : "Nessun controller rilevato: collegalo e premi un pulsante qualsiasi."}
            </p>
          </div>
        </div>

        <div className="modal-panel__body modal-panel__body--scroll">
          <p className="gamepad-mapping__hint">
            Premi «Assegna» e poi il pulsante sul pad. Un pulsante comanda una sola azione: se era già
            usato, l’altra azione resta libera. La levetta sinistra sposta sempre la foto attiva, la
            destra sposta la foto ingrandita. La mappatura vale per questo PC.
          </p>
          <ul className="gamepad-mapping__list">
            {GAMEPAD_COMMANDS.map(({ command, label }) => {
              const button = mapping[command];
              const isListening = listeningFor === command;
              const isPressed = button !== null && pressedButtons.includes(button);
              return (
                <li
                  key={command}
                  className={isListening ? "gamepad-mapping__row gamepad-mapping__row--listening" : "gamepad-mapping__row"}
                >
                  <span className="gamepad-mapping__label">{label}</span>
                  <kbd className={isPressed ? "shortcut-help__kbd gamepad-mapping__kbd--pressed" : "shortcut-help__kbd"}>
                    {isListening ? "Premi un pulsante…" : gamepadButtonName(button, standardLayout)}
                  </kbd>
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    disabled={!pad}
                    onClick={() => setListeningFor(isListening ? null : command)}
                  >
                    {isListening ? "Annulla" : "Assegna"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    disabled={button === null}
                    onClick={() => saveGamepadMapping(assignGamepadButton(mapping, command, null))}
                  >
                    Nessuno
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="modal-panel__footer">
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setListeningFor(null);
              saveGamepadMapping({ ...DEFAULT_GAMEPAD_MAPPING });
            }}
          >
            Ripristina predefiniti
          </button>
          <button type="button" className="primary-button" onClick={close}>
            Fatto
          </button>
        </div>
      </div>
    </div>
  );
}
