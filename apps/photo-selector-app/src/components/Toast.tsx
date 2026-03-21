import { ToastType } from "./ToastProvider";

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
}

export function Toast({ message, type, onClose }: ToastProps) {
  const getIcon = () => {
    switch (type) {
      case "success":
        return "OK";
      case "error":
        return "ER";
      case "warning":
        return "!";
      case "info":
        return "i";
      default:
        return "";
    }
  };

  return (
    <div className={`toast toast--${type}`} role="status" aria-live="polite">
      <span className="toast__icon">{getIcon()}</span>
      <p className="toast__message">{message}</p>
      <button
        type="button"
        className="toast__close"
        onClick={onClose}
        aria-label="Chiudi notifica"
      >
        x
      </button>
    </div>
  );
}
