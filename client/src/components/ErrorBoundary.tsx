import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div className="mx-auto mt-24 max-w-md rounded-lg bg-soft px-6 py-8 text-center">
                <h1 className="text-xl font-extrabold tracking-heading">Something went wrong</h1>
                <p className="mt-2 text-muted">Reload the page to try again.</p>
                <button onClick={() => location.reload()} className="mt-4 font-bold text-accent underline">
                    Reload
                </button>
            </div>
        );
    }
}
