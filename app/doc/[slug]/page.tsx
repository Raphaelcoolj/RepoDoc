import { notFound } from 'next/navigation';
import Link from 'next/link';
import DocReader from '@/components/DocReader';
import DocFreshnessBanner from '@/components/DocFreshnessBanner';
import { connectDB } from '@/lib/db';
import GeneratedDocModel from '@/models/GeneratedDoc';
import { fixMarkdownTables } from '@/lib/markdown';
import { getBaseUrl, SITE_NAME } from '@/lib/seo';
import type { Metadata } from 'next';

interface Props {
  params: Promise<{ slug: string }>;
}

async function fetchMarkdown(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return fixMarkdownTables(await res.text());
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  await connectDB();
  const doc = await GeneratedDocModel.findOne({ slug }).lean();
  if (!doc) return { title: 'Not Found' };
  const title = `${doc.repoOwner}/${doc.repoName} Documentation`;
  const description = `AI-generated documentation for ${doc.repoOwner}/${doc.repoName}: architecture diagrams, setup instructions and code explanations.`;
  return {
    title,
    description,
    alternates: {
      canonical: `/doc/${slug}`,
    },
    openGraph: {
      title,
      description,
      url: `/doc/${slug}`,
      siteName: SITE_NAME,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
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

  const markdown = await fetchMarkdown(doc.cloudinaryUrl);
  const base = getBaseUrl();
  const canonical = `${base}/doc/${doc.slug}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: `${doc.repoOwner}/${doc.repoName} Documentation`,
    description: `AI-generated documentation for ${doc.repoOwner}/${doc.repoName}: architecture diagrams, setup instructions and code explanations.`,
    url: canonical,
    datePublished: new Date(doc.createdAt).toISOString(),
    author: {
      '@type': 'Organization',
      name: doc.repoOwner,
      url: doc.repoUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: base,
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonical,
    },
  };

  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      {/* Top bar */}
      <nav className="glass sticky top-0 z-50 px-4 md:px-6 py-3.5 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold gradient-text">
          GramDoc
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

        <DocReader cloudinaryUrl={doc.cloudinaryUrl} initialMarkdown={markdown} />
      </div>
    </main>
  );
}
