import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center hero-glow px-4 text-center">
      <h1 className="text-6xl font-black gradient-text mb-4">404</h1>
      <p className="text-slate-400 mb-8 text-lg">
        This page doesn&apos;t exist, or the documentation has been removed.
      </p>
      <Link
        href="/"
        className="bg-brand-600 hover:bg-brand-500 text-white px-6 py-3 rounded-xl font-medium transition-colors"
      >
        Back to home
      </Link>
    </main>
  );
}
