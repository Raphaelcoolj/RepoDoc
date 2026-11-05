import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { canonicalizeRepoUrl } from './repoUrl';

const MAX_CONTENT_BYTES = 50 * 1024; // 50 KB
const MAX_FILES_PATH_B = 30;
const SINGLE_FILE_MAX_BYTES = 10 * 1024; // 10 KB
const SIZE_GATE_KB = 5 * 1024; // 5 MB in KB

const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb',
  '.php', '.md', '.json', '.toml', '.yaml', '.yml',
]);
const ALLOWED_FILENAMES = new Set(['.env.example', 'Dockerfile', 'dockerfile']);

const HIGH_SIGNAL_FILES = [
  'README.md', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'gemfile', 'composer.json', 'pom.xml', 'build.gradle',
  'index.ts', 'index.js', 'main.py', 'app.py', 'server.ts', 'main.go', 'main.rs', 'main.java', 'routes.rb', 'app.rb', 'routes/web.php',
  'next.config.ts', 'next.config.js', 'next.config.mjs', 'vite.config.ts', 'vite.config.js', 'nuxt.config.ts', 'svelte.config.js',
  'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile', 'Procfile', 'requirements.txt',
];

export interface RepoFileData {
  fileTree: string;
  keyFiles: Record<string, string>;
}

export function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function isAllowedFile(filename: string): boolean {
  if (ALLOWED_FILENAMES.has(filename)) return true;
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

function truncateIfNeeded(content: string): string {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > SINGLE_FILE_MAX_BYTES) {
    return content.slice(0, SINGLE_FILE_MAX_BYTES) + '\n[truncated]';
  }
  return content;
}

function capToLimit(files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  let total = 0;
  for (const [filepath, content] of Object.entries(files)) {
    const bytes = Buffer.byteLength(content, 'utf8');
    if (total + bytes > MAX_CONTENT_BYTES) break;
    result[filepath] = content;
    total += bytes;
  }
  return result;
}

// ─── Path A: Zip download ──────────────────────────────────────────────────────
async function fetchViaZip(owner: string, repo: string, branch: string): Promise<RepoFileData> {
  const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`;
  const response = await axios.get<ArrayBuffer>(url, {
    headers: githubHeaders(),
    responseType: 'arraybuffer',
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gramdoc-'));
  const zipPath = path.join(tmpDir, 'repo.zip');

  try {
    fs.writeFileSync(zipPath, Buffer.from(response.data));
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    const keyFiles: Record<string, string> = {};
    const treeLines: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName;
      // Strip the root folder prefix that GitHub adds
      const relativePath = entryName.split('/').slice(1).join('/');
      const filename = path.basename(relativePath);

      treeLines.push(relativePath);

      if (!isAllowedFile(filename)) continue;

      const content = entry.getData().toString('utf8');
      keyFiles[relativePath] = truncateIfNeeded(content);
    }

    return {
      fileTree: treeLines.join('\n'),
      keyFiles: capToLimit(keyFiles),
    };
  } finally {
    // Cleanup /tmp
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

// ─── Path B: Trees API + selective fetch ──────────────────────────────────────
async function fetchViaTreesApi(owner: string, repo: string, ref: string): Promise<RepoFileData> {
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const treeRes = await axios.get<{
    tree: Array<{ path: string; type: string; size?: number }>;
  }>(treeUrl, { headers: githubHeaders() });

  const allFiles = treeRes.data.tree.filter((n) => n.type === 'blob');
  const treeLines = allFiles.map((n) => n.path);

  // Select high-signal files first, then fill up to cap
  const selected: string[] = [];

  for (const hsf of HIGH_SIGNAL_FILES) {
    const match = allFiles.find((f) => path.basename(f.path) === hsf);
    if (match && !selected.includes(match.path)) {
      selected.push(match.path);
    }
  }

  for (const file of allFiles) {
    if (selected.length >= MAX_FILES_PATH_B) break;
    if (selected.includes(file.path)) continue;
    if (!isAllowedFile(path.basename(file.path))) continue;
    selected.push(file.path);
  }

  const keyFiles: Record<string, string> = {};
  let totalBytes = 0;

  await Promise.allSettled(
    selected.map(async (filePath) => {
      try {
        const contentUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`;
        const res = await axios.get<{ content: string; encoding: string }>(contentUrl, {
          headers: githubHeaders(),
        });
        const content = Buffer.from(res.data.content, 'base64').toString('utf8');
        const truncated = truncateIfNeeded(content);
        const bytes = Buffer.byteLength(truncated, 'utf8');
        if (totalBytes + bytes <= MAX_CONTENT_BYTES) {
          keyFiles[filePath] = truncated;
          totalBytes += bytes;
        }
      } catch {
        // Skip files that fail to fetch
      }
    })
  );

  return {
    fileTree: treeLines.join('\n'),
    keyFiles,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────
export interface ResolvedRepo {
  repoId: number;
  owner: string;
  repo: string;
  repoKey: string;
  defaultBranch: string;
  sizeKb: number;
}

export async function resolveRepo(owner: string, repo: string): Promise<ResolvedRepo> {
  const res = await axios.get<{
    id: number;
    full_name: string;
    default_branch: string;
    size: number;
  }>(`https://api.github.com/repos/${owner}/${repo}`, { headers: githubHeaders() });

  const fullName = res.data.full_name;
  const slash = fullName.indexOf('/');
  const canonicalOwner = fullName.slice(0, slash);
  const canonicalRepo = fullName.slice(slash + 1);

  return {
    repoId: res.data.id,
    owner: canonicalOwner,
    repo: canonicalRepo,
    repoKey: fullName.toLowerCase(),
    defaultBranch: res.data.default_branch,
    sizeKb: res.data.size,
  };
}

export async function fetchHeadCommitSha(
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const res = await axios.get<string>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
    {
      headers: { ...githubHeaders(), Accept: 'application/vnd.github.sha' },
      responseType: 'text',
      transformResponse: [(data: string) => data],
    }
  );
  const sha = String(res.data).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('Unexpected commit sha response from GitHub');
  }
  return sha;
}

export async function fetchRepoFiles(
  owner: string,
  repo: string,
  opts: { ref?: string; sizeKb?: number } = {}
): Promise<RepoFileData> {
  let size = opts.sizeKb;
  let branch = opts.ref;

  if (size === undefined || branch === undefined) {
    const metaRes = await axios.get<{ size: number; default_branch: string }>(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: githubHeaders() }
    );
    size = size ?? metaRes.data.size;
    branch = branch ?? metaRes.data.default_branch;
  }

  if (size < SIZE_GATE_KB) {
    return fetchViaZip(owner, repo, branch);
  } else {
    return fetchViaTreesApi(owner, repo, branch);
  }
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const { owner, repo } = canonicalizeRepoUrl(url);
  return { owner, repo };
}
