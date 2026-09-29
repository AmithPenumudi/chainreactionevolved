import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordCrash } from "@/lib/crash-log";

interface Props {
  children: ReactNode;
  /** Called by "Try again"; defaults to remounting the children. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence: a render error anywhere below shows a recovery screen (and is written
 * to the on-device crash log) instead of leaving a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordCrash(
      Object.assign(new Error(error.message), {
        stack: `${error.stack ?? ""}\ncomponent stack:${info.componentStack ?? ""}`,
      }),
      "boundary",
    );
  }

  private reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="grid min-h-screen place-items-center bg-background px-6 py-12 text-center text-foreground"
      >
        <div className="max-w-sm">
          <h1 className="font-display text-2xl font-black tracking-tight">Something went wrong</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The game hit an unexpected error. Your profile and progress are saved. You can try
            again, or reload the app.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              onClick={this.reset}
              className="rounded-md bg-foreground px-5 py-2 font-display text-xs tracking-[0.2em] text-background"
            >
              TRY AGAIN
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-foreground/30 px-5 py-2 font-display text-xs tracking-[0.2em]"
            >
              RELOAD
            </button>
          </div>
        </div>
      </div>
    );
  }
}
