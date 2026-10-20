import { useEffect, useRef, useState } from "react";
import { PHOTO_CLASSIFICATION_SHORTCUTS } from "../services/photo-classification";
import { describeGamepadMapping, setGamepadMappingEditorOpen } from "../services/gamepad-controls";
import { useGamepadStore } from "./GamepadMappingModal";

interface PhotoClassificationHelpButtonProps {
  className?: string;
  title?: string;
}

export function PhotoClassificationHelpButton({
  className,
  title = "Scorciatoie"
}: PhotoClassificationHelpButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { mapping: gamepadMapping } = useGamepadStore();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className={className ? `shortcut-help ${className}` : "shortcut-help"}
    >
      <button
        type="button"
        className="ghost-button shortcut-help__button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label="Mostra scorciatoie classificazione foto"
      >
        Info
      </button>

      {isOpen ? (
        <div className="shortcut-help__popover" role="dialog" aria-label={title}>
          <strong className="shortcut-help__title">{title}</strong>
          <ul className="shortcut-help__list">
            {PHOTO_CLASSIFICATION_SHORTCUTS.map((item) => (
              <li key={item.keys} className="shortcut-help__item">
                <kbd className="shortcut-help__kbd">{item.keys}</kbd>
                <span>{item.description}</span>
              </li>
            ))}
          </ul>
          <strong className="shortcut-help__title">Controller (pad Xbox o generico)</strong>
          <ul className="shortcut-help__list">
            {describeGamepadMapping(gamepadMapping).map((item) => (
              <li key={`${item.control}-${item.description}`} className="shortcut-help__item">
                <kbd className="shortcut-help__kbd">{item.control}</kbd>
                <span>{item.description}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost-button ghost-button--small shortcut-help__customize"
            onClick={() => {
              setIsOpen(false);
              setGamepadMappingEditorOpen(true);
            }}
          >
            Personalizza pulsanti…
          </button>
        </div>
      ) : null}
    </div>
  );
}
