import type { MetadataRoute } from 'next';
import { getBaseUrl } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  const base = getBaseUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/dashboard', '/settings', '/onboarding', '/login'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
