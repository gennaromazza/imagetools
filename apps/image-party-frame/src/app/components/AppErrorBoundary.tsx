import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("PartyFrame UI crashed", error, info);
  }

  private recover = (): void => {
    this.setState({ error: null });
    window.location.hash = "#/";
    if (window.location.protocol !== "file:") {
      window.location.assign("/");
    }
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] grid place-items-center p-8">
        <section className="w-full max-w-xl rounded-[28px] border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center shadow-[0_24px_60px_rgba(0,0,0,0.2)]">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-[var(--danger)]" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">PartyFrame ha incontrato un errore</h1>
          <p className="mt-3 text-sm text-[var(--app-text-muted)]">
            Il progetto non è stato eliminato. Torna alla Home e riprendi il flusso in sicurezza.
          </p>
          <details className="mt-5 rounded-xl bg-[var(--app-field)] p-3 text-left text-xs text-[var(--app-text-subtle)]">
            <summary className="cursor-pointer">Dettagli tecnici</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
          </details>
          <button
            type="button"
            onClick={this.recover}
            className="mt-6 rounded-xl bg-[var(--brand-primary)] px-5 py-3 font-medium text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]"
          >
            Torna alla Home
          </button>
        </section>
      </main>
    );
  }
}
