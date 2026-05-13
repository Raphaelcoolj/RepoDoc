'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="bg-red-500/10 border border-red-500/20 rounded-3xl p-10 max-w-md glow-border">
        <div className="text-5xl mb-6">⚠️</div>
        <h2 className="text-2xl font-bold text-white mb-2">Something went wrong!</h2>
        <p className="text-slate-400 text-sm mb-8">
          {error.message || 'An unexpected error occurred while loading this page.'}
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => reset()}
            className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl font-medium transition-all"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="glass text-slate-300 px-6 py-2.5 rounded-xl font-medium transition-all"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
