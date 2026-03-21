import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Component } from "react";
export class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught:", error, errorInfo);
    }
    render() {
        if (this.state.hasError && this.state.error) {
            if (this.props.fallback) {
                return this.props.fallback(this.state.error);
            }
            return (_jsxs("div", { style: {
                    padding: "2rem",
                    margin: "1rem",
                    borderRadius: "12px",
                    background: "rgba(220, 80, 80, 0.1)",
                    border: "1px solid rgba(220, 80, 80, 0.3)",
                    color: "#f7f0e8"
                }, children: [_jsx("h2", { children: "Errore nell'applicazione" }), _jsx("p", { children: this.state.error.message }), _jsx("button", { onClick: () => this.setState({ hasError: false, error: null }), style: {
                            padding: "0.8rem 1.2rem",
                            borderRadius: "999px",
                            border: "0",
                            background: "rgba(226, 155, 88, 0.9)",
                            color: "#201611",
                            cursor: "pointer",
                            fontWeight: "600"
                        }, children: "Riprova" })] }));
        }
        return this.props.children;
    }
}
//# sourceMappingURL=ErrorBoundary.js.map