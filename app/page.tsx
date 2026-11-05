import Link from 'next/link';
import type { Metadata } from 'next';
import { auth } from '@/auth';
import { getBaseUrl, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/seo';

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
};

export default async function LandingPage() {
  const session = await auth();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: getBaseUrl(),
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    sameAs: [SITE_URL],
    creator: {
      '@type': 'Organization',
      name: 'SphereBrilliq',
      url: 'https://spherebrilliq.online',
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };

  return (
    <main className="min-h-screen flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      {/* Nav */}
      <nav className="glass sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold gradient-text">RepoDoc</span>
        <div className="flex items-center gap-4">
          {session?.user ? (
            <>
              <Link
                href="/dashboard"
                className="text-sm text-slate-300 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/api/auth/signout"
                className="text-sm bg-surface-700 px-4 py-2 rounded-lg hover:bg-surface-600 transition-colors"
              >
                Sign out
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="text-sm bg-brand-600 hover:bg-brand-500 px-5 py-2 rounded-lg font-medium transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="hero-glow flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-sm text-brand-400 mb-8">
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
          Powered by GPT-4o, Claude, Gemini &amp; more
        </div>

        <h1 className="text-5xl md:text-7xl font-black tracking-tight max-w-4xl leading-[1.05]">
          <span className="gradient-text">Instant docs</span>
          <br />
          for any GitHub repo
        </h1>

        <p className="mt-6 text-lg md:text-xl text-slate-400 max-w-2xl leading-relaxed">
          Paste a repository URL. RepoDoc analyzes the codebase using multiple
          AI models and generates structured documentation with Mermaid.js
          architecture diagrams — in seconds.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href={session?.user ? '/dashboard' : '/login'}
            className="bg-brand-600 hover:bg-brand-500 text-white px-8 py-3.5 rounded-xl font-semibold text-base transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(99,102,241,0.4)]"
          >
            {session?.user ? 'Go to Dashboard →' : 'Get started free →'}
          </Link>
          <a
            href="https://github.com/Raphaelcoolj/RepoDoc.git"
            target="_blank"
            rel="noopener noreferrer"
            className="glass hover:glow-border text-slate-300 px-8 py-3.5 rounded-xl font-medium text-base transition-all"
          >
            View on GitHub
          </a>
        </div>

        {/* Feature cards */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full text-left">
          {[
            {
              icon: '⚡',
              title: 'Cache-first',
              body: 'AI runs once per unique repo. All users share the same generated doc instantly.',
            },
            {
              icon: '🤖',
              title: 'Multi-model AI',
              body: 'GPT-4o-mini, Claude Haiku, Grok, Gemini 2.0 Flash, and DeepSeek work together on every doc.',
            },
            {
              icon: '🔑',
              title: 'BYOK unlimited',
              body: 'Add your own API keys for unlimited generations, bypassing the 3/day free tier.',
            },
            {
              icon: '📊',
              title: 'Mermaid diagrams',
              body: 'Architecture diagrams auto-generated as interactive Mermaid.js graphs.',
            },
            {
              icon: '🔗',
              title: 'Shareable links',
              body: 'Every doc gets a public /doc/[slug] URL. No auth required to read.',
            },
            {
              icon: '🔒',
              title: 'Encrypted at rest',
              body: 'Your API keys are encrypted with AES-256-CBC before being stored.',
            },
          ].map((f) => (
            <div key={f.title} className="glass rounded-2xl p-6 hover:glow-border transition-all">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-white mb-1">{f.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#2a2a48] px-6 py-6 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} RepoDoc. Documentation-as-a-Service. Built
        by{' '}
        <a
          href="https://spherebrilliq.online"
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-400 hover:text-white transition-colors"
        >
          SphereBrilliq
        </a>
        .
      </footer>
    </main>
  );
}
