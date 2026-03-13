import type { PropsWithChildren, ReactNode } from "react";

interface PanelSectionProps extends PropsWithChildren {
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PanelSection({
  title,
  description,
  actions,
  children
}: PanelSectionProps) {
  return (
    <section className="panel-section">
      <header className="panel-section__header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {actions ? <div className="panel-section__actions">{actions}</div> : null}
      </header>
      <div className="panel-section__body">{children}</div>
    </section>
  );
}

