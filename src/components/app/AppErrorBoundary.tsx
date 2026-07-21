import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { EnvironmentBanner } from "../layout/EnvironmentBanner";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  retryKey: number;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    retryKey: 0,
  };

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Acadea frontend] Erreur React capturee.", {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
      environment: import.meta.env.VITE_APP_ENV ?? "development",
      firebaseProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    });
  }

  retry = () => {
    this.setState((state) => ({
      hasError: false,
      retryKey: state.retryKey + 1,
    }));
  };

  goHome = () => {
    this.setState({ hasError: false });
    window.location.assign("/");
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f8fb] p-4">
          <EnvironmentBanner />
          <section className="w-full max-w-md rounded border border-slate-200 bg-white p-6 text-center shadow-sm">
            <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-red-600" />
            <h1 className="text-2xl font-bold text-ink">Une erreur est survenue</h1>
            <p className="mt-2 text-sm text-slate-500">
              Acadéa n'a pas pu afficher cet écran. Votre session reste conservée.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button onClick={this.retry} className="primary-button justify-center" type="button">
                <RefreshCw className="h-4 w-4" /> Réessayer
              </button>
              <button onClick={this.goHome} className="secondary-button justify-center" type="button">
                Revenir à l'accueil
              </button>
            </div>
          </section>
        </main>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
