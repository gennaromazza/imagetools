import { Component, ReactNode, ErrorInfo } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error);
      }

      return (
        <div
          style={{
            padding: "2rem",
            margin: "1rem",
            borderRadius: "12px",
            background: "rgba(220, 80, 80, 0.1)",
            border: "1px solid rgba(220, 80, 80, 0.3)",
            color: "#f7f0e8"
          }}
        >
          <h2>Errore nell'applicazione</h2>
          <p>{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "0.8rem 1.2rem",
              borderRadius: "999px",
              border: "0",
              background: "rgba(226, 155, 88, 0.9)",
              color: "#201611",
              cursor: "pointer",
              fontWeight: "600"
            }}
          >
            Riprova
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
