import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { getBaseUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from '@/lib/seo';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: SITE_TITLE,
    template: '%s — RepoDoc',
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'documentation',
    'github',
    'AI',
    'mermaid',
    'code analysis',
    'repository documentation',
    'code documentation generator',
    'AI documentation',
  ],
  authors: [{ name: 'RepoDoc' }, { name: 'SphereBrilliq' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
