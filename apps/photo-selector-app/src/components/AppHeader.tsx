import type { MouseEvent } from "react";

type AppScreen = "browse" | "selection" | "review";

interface AppHeaderProps {
  logo: string;
  currentScreen: AppScreen;
  assetCount: number;
  selectedCount: number;
  projectName: string;
  folderPath?: string | null;
  folderPhotoCount?: number | null;
  ignoredNestedPhotoCount?: number;
  isFolderDetailsOpen?: boolean;
  isFolderTransitionBusy: boolean;
  folderTransitionLabel: string;
  isGoogleDriveBusy: boolean;
  driveConfigured: boolean;
  driveConnected: boolean;
  driveNeedsReconnect: boolean;
  driveAccountEmail: string | null;
  isGeneratingThumbnails: boolean;
  thumbnailDone: number;
  thumbnailTotal: number;
  showXmpStatus: boolean;
  xmpPhase: string;
  xmpLabel: string;
  onScreenChange: (screen: AppScreen) => void;
  onCreateProject: () => void;
  onCorrectMaster: () => void;
  onRenameProject: () => void;
  onDriveConnect: () => void;
  onDriveExport: () => void;
  onDriveImport: () => void;
  onShowImportProgress: () => void;
  onToggleFolderDetails?: () => void;
}

export function AppHeader(props: AppHeaderProps) {
  const hasProject = props.assetCount > 0;
  const globallyBusy = props.isFolderTransitionBusy || props.isGoogleDriveBusy;
  const runMenuAction = (event: MouseEvent<HTMLButtonElement>, action: () => void) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
    action();
  };
  const folderName = props.folderPath?.split(/[\\/]+/).filter(Boolean).pop() ?? "";

  return (
    <header className="app-header app-header--compact">
      <div className="app-header__identity">
        <img className="app-header__logo" src={props.logo} alt="" />
        <div className="app-header__brand">
          <h1 className="app-header__title">Image Select Pro</h1>
          <button
            type="button"
            className="app-header__inline-project"
            onClick={props.onRenameProject}
            disabled={!hasProject || globallyBusy}
            title={hasProject ? "Rinomina progetto" : "Nessun progetto aperto"}
          >
            {hasProject ? `${props.projectName}  ✎` : "Nessun progetto"}
          </button>
        </div>
      </div>

      {props.folderPath ? (
        <button
          type="button"
          className={`app-header__folder-context${props.isFolderDetailsOpen ? " app-header__folder-context--open" : ""}`}
          onClick={props.onToggleFolderDetails}
          title={props.folderPath}
          aria-expanded={props.isFolderDetailsOpen}
        >
          <span aria-hidden="true">📁</span>
          <span className="app-header__folder-name">{folderName}</span>
          {typeof props.folderPhotoCount === "number" ? <span className="app-header__folder-count">{props.folderPhotoCount}</span> : null}
          {(props.ignoredNestedPhotoCount ?? 0) > 0 ? <span className="app-header__folder-warning" title={`${props.ignoredNestedPhotoCount} foto annidate ignorate`}>!</span> : null}
        </button>
      ) : null}

      <nav className="app-header__nav" aria-label="Fasi del progetto">
        {([
          ["browse", "Sfoglia"],
          ["selection", `Selezione (${props.selectedCount} tot.)`],
          ["review", `Riepilogo (${props.selectedCount} tot.)`],
        ] as const).map(([screen, label]) => (
          <button
            key={screen}
            type="button"
            className={props.currentScreen === screen ? "app-header__tab app-header__tab--active" : "app-header__tab"}
            onClick={() => props.onScreenChange(screen)}
            disabled={screen !== "browse" && !hasProject}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="app-header__statuses" aria-live="polite">
        {props.isGeneratingThumbnails ? (
          <button type="button" className="app-header__pipeline-status app-header__pipeline-status--button" onClick={props.onShowImportProgress} title="Mostra caricamento">
            <div className="pipeline-progress">
              <div className="pipeline-progress__fill" style={{ width: `${Math.round((props.thumbnailDone / Math.max(1, props.thumbnailTotal)) * 100)}%` }} />
            </div>
            <span className="pipeline-progress__label">{props.thumbnailDone}/{props.thumbnailTotal}</span>
          </button>
        ) : null}
        {props.isFolderTransitionBusy ? <span className="app-header__sync-status app-header__sync-status--pending" title={props.folderTransitionLabel}>Cambio cartella…</span> : null}
        {props.showXmpStatus ? <span className={`app-header__sync-status app-header__sync-status--${props.xmpPhase}`}>{props.xmpLabel}</span> : null}
        {props.driveNeedsReconnect ? (
          <button
            type="button"
            className="app-header__drive-state app-header__drive-state--expired"
            onClick={props.onDriveConnect}
            disabled={props.isGoogleDriveBusy}
            title="La sessione Google è scaduta: accedi di nuovo"
          >
            {props.isGoogleDriveBusy ? "Connessione…" : "Riconnetti Drive"}
          </button>
        ) : props.driveConnected && props.driveConfigured ? (
          <span className="app-header__drive-state" title={props.driveAccountEmail ?? "Google Drive collegato"}>Drive ✓</span>
        ) : null}
      </div>

      <div className="app-header__primary-actions">
        <button type="button" className="primary-button app-header__button" onClick={props.onCreateProject} disabled={globallyBusy}>Nuovo</button>
        <details className="app-header__more">
          <summary className="ghost-button app-header__button" aria-label="Azioni progetto">•••</summary>
          <div className="app-header__more-menu">
            {hasProject ? <button type="button" className="ghost-button" onClick={(event) => runMenuAction(event, props.onCorrectMaster)} disabled={globallyBusy}>Correggi master</button> : null}
            {!props.driveConnected || props.driveNeedsReconnect || !props.driveConfigured ? <button type="button" className="ghost-button" onClick={(event) => runMenuAction(event, props.onDriveConnect)} disabled={props.isGoogleDriveBusy || !props.driveConfigured}>{!props.driveConfigured ? "Drive non configurato" : props.driveNeedsReconnect ? "Riconnetti Google Drive" : "Collega Drive"}</button> : null}
            {hasProject ? <button type="button" className="ghost-button" onClick={(event) => runMenuAction(event, props.onDriveExport)} disabled={props.isGoogleDriveBusy || !props.driveConfigured}>Esporta su Drive</button> : null}
            <button type="button" className="ghost-button" onClick={(event) => runMenuAction(event, props.onDriveImport)} disabled={globallyBusy || !props.driveConfigured}>{hasProject ? "Continua da Drive" : "Recupera da Drive"}</button>
            <button
              type="button"
              className="ghost-button"
              onClick={(event) => runMenuAction(event, () => window.dispatchEvent(new Event("image-select-pro:reset-workspace-layout")))}
            >
              Ripristina layout
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
