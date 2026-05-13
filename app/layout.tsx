import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'RepoDoc — AI-Powered Repository Documentation',
  description:
    'Paste a GitHub URL. Get instant, AI-generated documentation with Mermaid architecture diagrams and plain-English code explanations.',
  keywords: ['documentation', 'github', 'AI', 'mermaid', 'code analysis'],
  openGraph: {
    title: 'RepoDoc',
    description: 'Documentation-as-a-Service for any GitHub repository.',
    type: 'website',
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
