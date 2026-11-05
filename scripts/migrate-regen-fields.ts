/**
 * Backfill freshness/regeneration fields on legacy GeneratedDoc records.
 *
 * Usage:
 *   node --experimental-strip-types scripts/migrate-regen-fields.ts [--dry-run]
 *
 * Env: MONGODB_URI (required), GITHUB_TOKEN (recommended),
 *       MIGRATION_MARK_LEGACY_OUTDATED=true  → set pipelineVersion=0 instead of PIPELINE_VERSION
 *
 * Idempotent: docs that already have repoId, commitSha and pipelineVersion are skipped.
 * GitHub rate limits are honoured: the script stops (exit 2) and can be re-run to resume.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { canonicalizeRepoUrl, InvalidRepoUrlError } from '../lib/repoUrl.ts';
import { PIPELINE_VERSION } from '../lib/pipelineVersion.ts';
import { publicIdFromCloudinaryUrl } from '../lib/cloudinary.ts';

interface RawDoc {
  _id: mongoose.Types.ObjectId;
  repoUrl?: string;
  slug?: string;
  cloudinaryUrl?: string;
  createdAt?: Date;
  repoId?: number;
  repoKey?: string;
  defaultBranch?: string;
  commitSha?: string;
  pipelineVersion?: number;
  version?: number;
  status?: string;
  failureCount?: number;
  currentPublicId?: string;
  previousPublicIds?: string[];
}

interface ResolvedIdentity {
  repoId: number;
  owner: string;
  repo: string;
  repoKey: string;
  defaultBranch: string;
}

interface GhResult<T> {
  status: number;
  data: T | null;
  remaining: number;
  reset: number;
}

class RateLimitStop extends Error {
  readonly reset: number;
  constructor(reset: number) {
    super('GitHub rate limit reached');
    this.name = 'RateLimitStop';
    this.reset = reset;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRemaining = 9999;
let lastReset = 0;

function guardRate(): void {
  if (lastRemaining <= 2) throw new RateLimitStop(lastReset);
}

async function ghGet<T>(path: string): Promise<GhResult<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'repodoc-migration',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com${path}`, { headers });
  const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? 'NaN');
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? '0');
  const remainingSafe = Number.isFinite(remaining) ? remaining : 9999;
  lastRemaining = remainingSafe;
  lastReset = reset;

  if (res.status === 403 || res.status === 429) {
    if (remainingSafe <= 0) throw new RateLimitStop(reset);
    throw new Error(`GitHub API ${res.status} for ${path}`);
  }
  if (res.status >= 500) {
    throw new Error(`GitHub API ${res.status} for ${path}`);
  }
  if (res.status === 404) {
    return { status: 404, data: null, remaining: remainingSafe, reset };
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${path}`);
  }
  const data = (await res.json()) as T;
  return { status: res.status, data, remaining: remainingSafe, reset };
}

interface GithubRepoPayload {
  id: number;
  full_name: string;
  default_branch: string;
}

function mapRepoPayload(payload: GithubRepoPayload): ResolvedIdentity {
  const slash = payload.full_name.indexOf('/');
  const owner = payload.full_name.slice(0, slash);
  const repo = payload.full_name.slice(slash + 1);
  return {
    repoId: payload.id,
    owner,
    repo,
    repoKey: payload.full_name.toLowerCase(),
    defaultBranch: payload.default_branch,
  };
}

async function resolveIdentity(
  doc: RawDoc,
  owner: string,
  repo: string
): Promise<ResolvedIdentity> {
  const byName = await ghGet<GithubRepoPayload>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  );
  if (byName.status === 200 && byName.data) {
    return mapRepoPayload(byName.data);
  }
  if (typeof doc.repoId === 'number') {
    const byId = await ghGet<GithubRepoPayload>(`/repositories/${doc.repoId}`);
    if (byId.status === 200 && byId.data) {
      return mapRepoPayload(byId.data);
    }
  }
  throw new Error('repository not found on GitHub (deleted or private)');
}

async function backfillCommitSha(
  owner: string,
  repo: string,
  createdAt: Date | undefined
): Promise<string | null> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`;
  if (createdAt) {
    const until = await ghGet<Array<{ sha: string }>>(
      `${base}?until=${encodeURIComponent(createdAt.toISOString())}&per_page=1`
    );
    const sha = until.data?.[0]?.sha;
    if (sha) return sha;
  }
  const head = await ghGet<Array<{ sha: string }>>(`${base}?per_page=1`);
  return head.data?.[0]?.sha ?? null;
}

function isLegacy(doc: RawDoc): boolean {
  return (
    typeof doc.repoId !== 'number' ||
    typeof doc.commitSha !== 'string' ||
    typeof doc.pipelineVersion !== 'number'
  );
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');
  dotenv.config({ path: ['.env.local', '.env'] });

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    return 1;
  }

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) {
      console.error('MongoDB connection is not established');
      return 1;
    }

    const collections = await db.listCollections().toArray();
    if (!collections.some((c) => c.name === 'generateddocs')) {
      const names = collections.map((c) => c.name).join(', ') || '(none)';
      console.error(`collection generateddocs not found; available: ${names}`);
      return 1;
    }

    const col = db.collection('generateddocs');

    const indexes = await col.indexes();
    const repoUrlIdx = indexes.find((i) => i.name === 'repoUrl_1');
    if (repoUrlIdx?.unique) {
      if (dryRun) {
        console.log('[dry-run] would drop unique index repoUrl_1 (repoUrl becomes non-unique)');
      } else {
        await col.dropIndex('repoUrl_1');
        console.log('dropped unique index repoUrl_1');
      }
    }
    if (dryRun) {
      console.log('[dry-run] would ensure indexes: repoId (partial unique), repoKey, repoUrl, slug (unique)');
    } else {
      try {
        await col.createIndex(
          { repoId: 1 },
          { unique: true, partialFilterExpression: { repoId: { $exists: true } } }
        );
        await col.createIndex({ repoKey: 1 });
        await col.createIndex({ repoUrl: 1 });
        await col.createIndex({ slug: 1 }, { unique: true });
      } catch (err) {
        console.error(
          'index setup failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    const docs = (await col.find({}).toArray()) as unknown as RawDoc[];
    const legacy = docs.filter(isLegacy);
    console.log(
      `${dryRun ? '[dry-run] ' : ''}scanned ${docs.length} docs, ${legacy.length} legacy`
    );

    const targetPipelineVersion =
      process.env.MIGRATION_MARK_LEGACY_OUTDATED === 'true'
        ? 0
        : PIPELINE_VERSION;

    const identityById = new Map<string, ResolvedIdentity>();
    const shaById = new Map<string, string>();
    const errors: string[] = [];

    for (const doc of legacy) {
      const label = `slug=${doc.slug ?? doc._id}`;
      try {
        if (typeof doc.repoUrl !== 'string') {
          throw new InvalidRepoUrlError('missing repoUrl');
        }
        const { owner, repo } = canonicalizeRepoUrl(doc.repoUrl);

        if (
          typeof doc.repoId !== 'number' ||
          doc.repoKey == null ||
          doc.defaultBranch == null
        ) {
          const identity = await resolveIdentity(doc, owner, repo);
          identityById.set(String(doc._id), identity);
        }

        if (typeof doc.commitSha !== 'string') {
          const identity = identityById.get(String(doc._id));
          const sha = await backfillCommitSha(
            identity?.owner ?? owner,
            identity?.repo ?? repo,
            doc.createdAt
          );
          if (!sha) {
            throw new Error('no commit found for repository');
          }
          shaById.set(String(doc._id), sha);
        }

        await sleep(250);
      } catch (err) {
        if (err instanceof RateLimitStop) throw err;
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${label}: ${message}`);
      } finally {
        guardRate();
      }
    }

    const effectiveRepoId = (doc: RawDoc): number | null => {
      if (typeof doc.repoId === 'number') return doc.repoId;
      return identityById.get(String(doc._id))?.repoId ?? null;
    };

    const groups = new Map<number, RawDoc[]>();
    for (const doc of docs) {
      const id = effectiveRepoId(doc);
      if (id == null) continue;
      const list = groups.get(id) ?? [];
      list.push(doc);
      groups.set(id, list);
    }

    const duplicateIds = new Set<number>();
    for (const [id, list] of groups) {
      if (list.length > 1) {
        duplicateIds.add(id);
        console.log('');
        console.log(`DUPLICATE repoId ${id} — manual review required (no changes made):`);
        for (const d of list) {
          console.log(`  slug=${d.slug ?? d._id} url=${d.repoUrl ?? '(missing)'}`);
        }
      }
    }

    let migrated = 0;
    for (const doc of legacy) {
      const id = effectiveRepoId(doc);
      if (id != null && duplicateIds.has(id)) continue;

      const identity = identityById.get(String(doc._id));
      const set: Record<string, unknown> = {};
      if (identity) {
        if (typeof doc.repoId !== 'number') set.repoId = identity.repoId;
        if (doc.repoKey == null) set.repoKey = identity.repoKey;
        if (doc.defaultBranch == null) set.defaultBranch = identity.defaultBranch;
      }
      const sha = shaById.get(String(doc._id));
      if (sha && typeof doc.commitSha !== 'string') set.commitSha = sha;
      if (typeof doc.pipelineVersion !== 'number') {
        set.pipelineVersion = targetPipelineVersion;
      }
      if (typeof doc.version !== 'number') set.version = 1;
      if (doc.status == null) set.status = 'ready';
      if (typeof doc.failureCount !== 'number') set.failureCount = 0;
      if (doc.currentPublicId == null) {
        set.currentPublicId = publicIdFromCloudinaryUrl(doc.cloudinaryUrl ?? '');
      }
      if (doc.previousPublicIds == null) set.previousPublicIds = [];

      if (Object.keys(set).length === 0) continue;

      const label = `slug=${doc.slug ?? doc._id}`;
      if (dryRun) {
        console.log(`[dry-run] would update ${label}: ${JSON.stringify(set)}`);
      } else {
        await col.updateOne({ _id: doc._id }, { $set: set });
        console.log(`updated ${label}`);
      }
      migrated += 1;
    }

    console.log('');
    console.log(
      `Done${dryRun ? ' (dry-run)' : ''}: migrated=${migrated} duplicates=${duplicateIds.size} errors=${errors.length}`
    );
    for (const e of errors) {
      console.error(`  error: ${e}`);
    }
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof RateLimitStop) {
      const when = err.reset
        ? ` (resets at ${new Date(err.reset * 1000).toISOString()})`
        : '';
      console.error(
        `Stopped: GitHub rate limit reached${when}. Re-run to resume — the script is idempotent.`
      );
      process.exitCode = 2;
      return;
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
