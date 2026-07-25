import { useEffect } from "react";

export function ActionSnackbar({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="fixed bottom-24 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded border border-blue-200 bg-ink px-4 py-3 text-center text-sm font-semibold text-white shadow-xl" role="status" aria-live="polite">
      {message}
    </div>
  );
}
