"use client";

import { Component, type ReactNode } from "react";

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// catches render/runtime errors in a widget so one broken section can't blank
// the whole page (a spotify api shape bug once took down the entire home page)
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[error-boundary]", error);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
