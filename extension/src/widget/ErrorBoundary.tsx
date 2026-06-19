// React error boundary that catches widget render errors and shows a minimal fallback.
// Prevents a widget crash from breaking or freezing the host page.

import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

/** Catches any render error in the widget tree and shows a non-intrusive fallback. */
class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[PagePilot] Widget error:", error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            background: "#0F172A",
            border: "1px solid #ef4444",
            borderRadius: "12px",
            padding: "12px 16px",
            color: "#ef4444",
            fontSize: "12px",
            zIndex: 2147483647,
            maxWidth: "200px",
          }}
        >
          Page Pilot encountered an error. Please refresh the page.
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
