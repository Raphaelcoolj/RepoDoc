export const SITE_NAME = 'GramDoc';
export const SITE_TITLE = 'GramDoc — AI-Powered Repository Documentation';
export const SITE_DESCRIPTION =
  'GramDoc — paste a GitHub URL and get instant, AI-generated documentation with Mermaid architecture diagrams and plain-English code explanations.';
export const SITE_URL = 'https://github.com/Raphaelcoolj/RepoDoc';

export function getBaseUrl(): string {
  const explicit = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
