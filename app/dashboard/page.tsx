import { auth } from '@/auth';
import { connectDB } from '@/lib/db';
import GeneratedDocModel from '@/models/GeneratedDoc';
import UserModel from '@/models/User';
import RepoForm from '@/components/RepoForm';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Generate documentation for any public GitHub repository.',
  robots: { index: false, follow: false },
};

interface DocRecord {
  slug: string;
  repoName: string;
  repoOwner: string;
  repoUrl: string;
  viewCount: number;
  createdAt: string;
}

export default async function DashboardPage() {
  const session = await auth();

  await connectDB();

  const [dbUser, recentDocs] = await Promise.all([
    UserModel.findById(session!.user.id).lean(),
    GeneratedDocModel.find({ createdBy: session!.user.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const hasByok = !!(dbUser?.apiKeys?.provider1?.key || dbUser?.apiKeys?.provider2?.key);
  const freeUsed = dbUser?.freeDocsUsed ?? 0;
  const freeRemaining = Math.max(0, 3 - freeUsed);

  const docs: DocRecord[] = recentDocs.map((d) => ({
    slug: d.slug,
    repoName: d.repoName,
    repoOwner: d.repoOwner,
    repoUrl: d.repoUrl,
    viewCount: d.viewCount,
    createdAt: d.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-white">Dashboard</h1>
        <p className="text-slate-400 mt-1">
          Generate AI-powered documentation for any public GitHub repository.
        </p>
      </div>

      {/* Usage banner */}
      {!hasByok && (
        <div className="glass rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white">
              Free tier: <span className="gradient-text">{freeRemaining}/3 remaining today</span>
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Add your own API keys for unlimited generations.
            </p>
          </div>
          <Link
            href="/settings"
            className="text-sm bg-brand-600 hover:bg-brand-500 px-5 py-2 rounded-lg font-medium transition-colors whitespace-nowrap"
          >
            Add API keys →
          </Link>
        </div>
      )}

      {hasByok && (
        <div className="glass rounded-2xl p-5 flex items-center gap-3">
          <span className="text-green-400 text-lg">✓</span>
          <p className="text-sm text-slate-300">
            BYOK active — <span className="text-green-400 font-medium">unlimited generations</span>
          </p>
        </div>
      )}

      {/* Repo form */}
      <div className="glass rounded-2xl p-5 sm:p-8">
        <h2 className="text-lg sm:text-xl font-bold text-white mb-4">Generate Documentation</h2>
        <RepoForm freeRemaining={freeRemaining} hasByok={hasByok} />
      </div>

      {/* Recent docs */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Your Documents</h2>
        {docs.length === 0 ? (
          <div className="glass rounded-2xl p-8 sm:p-12 text-center">
            <p className="text-4xl mb-4">📄</p>
            <p className="text-slate-400">No documents yet. Generate your first one above!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {docs.map((doc) => (
              <Link
                key={doc.slug}
                href={`/doc/${doc.slug}`}
                className="glass rounded-xl p-5 hover:glow-border transition-all group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-white group-hover:text-brand-400 transition-colors truncate">
                      {doc.repoOwner}/{doc.repoName}
                    </p>
                    <p className="text-xs text-slate-500 mt-1 truncate">{doc.repoUrl}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 mt-1">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                  <span>👁 {doc.viewCount} views</span>
                  <span className="text-brand-400 group-hover:underline">Read →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
