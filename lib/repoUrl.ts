export interface RepoIdentity {
  owner: string;
  repo: string;
  repoKey: string;
}

export class InvalidRepoUrlError extends Error {
  constructor(message = 'Invalid GitHub repository URL') {
    super(message);
    this.name = 'InvalidRepoUrlError';
  }
}

export function canonicalizeRepoUrl(input: string): RepoIdentity {
  const raw = input.trim();
  if (!raw) throw new InvalidRepoUrlError();

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidRepoUrlError();
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new InvalidRepoUrlError();
  }

  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) throw new InvalidRepoUrlError();

  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(segments[0]);
    repo = decodeURIComponent(segments[1]);
  } catch {
    throw new InvalidRepoUrlError();
  }

  if (repo.toLowerCase().endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  if (!owner || !repo) throw new InvalidRepoUrlError();
  if (/[\s/\\]/.test(owner) || /[\s/\\]/.test(repo)) throw new InvalidRepoUrlError();

  return { owner, repo, repoKey: `${owner}/${repo}`.toLowerCase() };
}
