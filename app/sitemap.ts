import type { MetadataRoute } from 'next';
import { getBaseUrl } from '@/lib/seo';
import { connectDB } from '@/lib/db';
import GeneratedDocModel from '@/models/GeneratedDoc';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl();
  const entries: MetadataRoute.Sitemap = [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];

  try {
    await connectDB();
    const docs = await GeneratedDocModel.find(
      {},
      { slug: 1, createdAt: 1 }
    ).lean();
    for (const doc of docs) {
      if (!doc.slug) continue;
      entries.push({
        url: `${base}/doc/${doc.slug}`,
        lastModified: doc.createdAt ?? undefined,
        changeFrequency: 'monthly',
        priority: 0.7,
      });
    }
  } catch {
    return entries;
  }

  return entries;
}
