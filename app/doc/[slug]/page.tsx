import { notFound } from 'next/navigation';
import Link from 'next/link';
import DocReader from '@/components/DocReader';
import DocFreshnessBanner from '@/components/DocFreshnessBanner';
import { connectDB } from '@/lib/db';
import GeneratedDocModel from '@/models/GeneratedDoc';
import type { Metadata } from 'next';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  await connectDB();
  const doc = await GeneratedDocModel.findOne({ slug }).lean();
  if (!doc) return { title: 'Not Found — RepoDoc' };
  return {
    title: `${doc.repoOwner}/${doc.repoName} — RepoDoc`,
    description: `AI-generated documentation for ${doc.repoUrl}`,
    openGraph: {
      title: `${doc.repoOwner}/${doc.repoName} — RepoDoc`,
      description: `AI-generated documentation with architecture diagrams`,
      type: 'article',
    },
  };
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;

  await connectDB();

  // Increment view count & fetch metadata
  const doc = await GeneratedDocModel.findOneAndUpdate(
    { slug },
    { $inc: { viewCount: 1 } },
    { returnDocument: 'after' }
  ).lean();

  if (!doc) notFound();

  return (
    <main className="min-h-screen">
      {/* Top bar */}
      <nav className="glass sticky top-0 z-50 px-4 md:px-6 py-3.5 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold gradient-text">
          RepoDoc
        </Link>
        <div className="flex items-center gap-4 text-sm overflow-hidden">
          <a
            href={doc.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-white transition-colors truncate max-w-[120px] md:max-w-none"
          >
            <span className="hidden md:inline">{doc.repoOwner}/</span>{doc.repoName} ↗
          </a>
          <span className="text-slate-500 hidden sm:inline">👁 {doc.viewCount}</span>
        </div>
      </nav>

      {/* Doc reader */}
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-3">
            <span className="text-brand-400 font-mono">{doc.repoOwner}</span>
            <span>/</span>
            <span className="text-brand-400 font-mono">{doc.repoName}</span>
          </div>
          <h1 className="text-2xl md:text-4xl font-black text-white">
            {doc.repoName} Documentation
          </h1>
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-500">
            <span>Generated {new Date(doc.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            <a href={doc.repoUrl} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
              View repository ↗
            </a>
          </div>
        </div>

        <DocFreshnessBanner slug={doc.slug} />

        <DocReader cloudinaryUrl={doc.cloudinaryUrl} />
      </div>
    </main>
  );
}
