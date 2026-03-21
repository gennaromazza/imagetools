import { useState } from "react";

interface DismissibleBannerProps {
  title: string;
  message: string;
  type?: "info" | "success" | "warning" | "error";
  onDismiss?: () => void;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function DismissibleBanner({
  title,
  message,
  type = "info",
  onDismiss,
  icon,
  action
}: DismissibleBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  if (isDismissed) return null;

  const typeIcons = {
    info: "i",
    success: "OK",
    warning: "!",
    error: "ER"
  };

  return (
    <div className={`dismissible-banner dismissible-banner--${type}`}>
      <div className="dismissible-banner__content">
        <div className="dismissible-banner__icon">
          {icon || typeIcons[type]}
        </div>
        <div className="dismissible-banner__text">
          <h4 className="dismissible-banner__title">{title}</h4>
          <p className="dismissible-banner__message">{message}</p>
        </div>
      </div>
      <div className="dismissible-banner__actions">
        {action && (
          <button
            type="button"
            className="dismissible-banner__action-button"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          className="dismissible-banner__close"
          onClick={handleDismiss}
          aria-label="Chiudi questo messaggio"
          title="Chiudi"
        >
          x
        </button>
      </div>
    </div>
  );
}
