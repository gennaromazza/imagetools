interface ConfirmModalProps {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  description,
  confirmText = "Conferma",
  cancelText = "Annulla",
  isDangerous = true,
  children,
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-panel modal-panel--confirm"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
      >
        <div className="modal-panel__header">
          <div>
            <h2 id="confirm-title">{title}</h2>
            <p id="confirm-description">{description}</p>
          </div>
        </div>

        {children ? <div className="modal-panel__body">{children}</div> : null}

        <div className="modal-panel__footer">
          <button type="button" className="ghost-button" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={isDangerous ? "primary-button primary-button--danger" : "primary-button"}
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
