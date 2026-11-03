import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { connectDB } from '@/lib/db';
import {
  fetchRepoFiles,
  resolveRepo,
  fetchHeadCommitSha,
  type ResolvedRepo,
} from '@/lib/github';
import { canonicalizeRepoUrl } from '@/lib/repoUrl';
import { PIPELINE_VERSION } from '@/lib/pipelineVersion';
import { generateDocumentation } from '@/lib/ai';
import { uploadMarkdownVersioned, destroyPublicId } from '@/lib/cloudinary';
import { validateGeneratedDoc } from '@/lib/docValidation';
import { acquireLock, releaseLock } from '@/lib/docLock';
import { getHeadSha, classifyChange } from '@/lib/freshness';
import { promoteDoc, recordRegenFailure } from '@/lib/promote';
import {
  FREE_TIER_DAILY_LIMIT,
  resolveByokKeys,
  checkQuota,
  incrementQuota,
} from '@/lib/quota';
import GeneratedDocModel from '@/models/GeneratedDoc';
import UserModel from '@/models/User';
import { Types } from 'mongoose';
import slugify from 'slugify';
import crypto from 'crypto';

const FAILURE_MARKER = '[Generation failed for this section]';

interface LeanDoc {
  _id: Types.ObjectId;
  slug: string;
  cloudinaryUrl: string;
  repoKey: string;
  repoId: number;
  defaultBranch: string;
  commitSha?: string;
  etag?: string;
  version: number;
  currentPublicId: string;
  previousPublicIds: string[];
  status: string;
}

function generateSlug(owner: string, repo: string): string {
  const base = slugify(`${owner}-${repo}`, { lower: true, strict: true });
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

async function hasFailureMarker(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes(FAILURE_MARKER);
  } catch {
    return false;
  }
}

type EvaluateOutcome =
  | { action: 'serve_cached' }
  | {
      action: 'regenerate';
      pinnedSha?: string;
      etag?: string;
    };

async function evaluateExisting(doc: LeanDoc): Promise<EvaluateOutcome> {
  // A doc carrying the failure marker is broken: always regenerate.
  if (await hasFailureMarker(doc.cloudinaryUrl)) {
    return { action: 'regenerate' };
  }

  const head = await getHeadSha({
    docId: doc._id,
    repoId: doc.repoId,
    repoKey: doc.repoKey,
    defaultBranch: doc.defaultBranch,
    etag: doc.etag,
  });

  if (
    head.status === 'github_unavailable' ||
    head.status === 'source_unavailable'
  ) {
    return { action: 'serve_cached' };
  }

  const now = new Date();

  if (head.status === 'unchanged') {
    await GeneratedDocModel.updateOne(
      { _id: doc._id },
      { $set: { lastCheckedAt: now } }
    );
    return { action: 'serve_cached' };
  }

  const newSha = head.sha;

  if (!doc.commitSha) {
    // Legacy doc without a baseline: regenerate from the current head.
    await GeneratedDocModel.updateOne(
      { _id: doc._id },
      { $set: { lastKnownHeadSha: newSha, lastCheckedAt: now } }
    );
    return { action: 'regenerate', pinnedSha: newSha, etag: head.etag };
  }

  if (newSha === doc.commitSha) {
    const set: Record<string, unknown> = {
      lastKnownHeadSha: newSha,
      lastCheckedAt: now,
    };
    if (head.etag) set.etag = head.etag;
    await GeneratedDocModel.updateOne({ _id: doc._id }, { $set: set });
    return { action: 'serve_cached' };
  }

  const classify = await classifyChange(doc.repoKey, doc.commitSha, newSha);
  if (classify.status === 'github_unavailable') {
    await GeneratedDocModel.updateOne(
      { _id: doc._id },
      { $set: { lastCheckedAt: now } }
    );
    return { action: 'serve_cached' };
  }

  const freshnessSet: Record<string, unknown> = {
    lastKnownHeadSha: newSha,
    commitsBehind: classify.commitsBehind,
    lastCheckedAt: now,
  };

  if (!classify.significant) {
    // Insignificant: record the etag so future checks short-circuit via 304.
    if (head.etag) freshnessSet.etag = head.etag;
    await GeneratedDocModel.updateOne(
      { _id: doc._id },
      { $set: freshnessSet }
    );
    return { action: 'serve_cached' };
  }

  // Significant: bookkeeping WITHOUT etag — a failed regeneration must not
  // let a later If-None-Match 304 away the very change we still need to pick up.
  await GeneratedDocModel.updateOne({ _id: doc._id }, { $set: freshnessSet });
  return { action: 'regenerate', pinnedSha: newSha, etag: head.etag };
}

async function regenerateExisting(
  doc: LeanDoc,
  resolvedRepo: ResolvedRepo,
  outcome: Extract<EvaluateOutcome, { action: 'regenerate' }>,
  sessionUserId: string
): Promise<NextResponse> {
  const userId = new Types.ObjectId(sessionUserId);

  const dbUser = await UserModel.findById(sessionUserId);
  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const { hasByok, userApiKeys } = await resolveByokKeys(dbUser);
  if (!checkQuota(dbUser, hasByok)) {
    return NextResponse.json(
      {
        error: `Daily free limit reached (${FREE_TIER_DAILY_LIMIT}/day). Add your own API keys for unlimited access.`,
        limitReached: true,
      },
      { status: 429 }
    );
  }

  const locked = await acquireLock(doc._id, userId);
  if (!locked) {
    return NextResponse.json({ status: 'regenerating', slug: doc.slug });
  }

  let uploadedPublicId: string | null = null;
  try {
    const commitSha =
      outcome.pinnedSha ??
      (await fetchHeadCommitSha(
        resolvedRepo.owner,
        resolvedRepo.repo,
        resolvedRepo.defaultBranch
      ));

    const { fileTree, keyFiles } = await fetchRepoFiles(
      resolvedRepo.owner,
      resolvedRepo.repo,
      { ref: commitSha, sizeKb: resolvedRepo.sizeKb }
    );

    const aiOutput = await generateDocumentation({
      fileTree,
      keyFiles,
      userApiKeys: userApiKeys.length > 0 ? userApiKeys : undefined,
    });
    await incrementQuota(dbUser, hasByok);

    const validation = validateGeneratedDoc(
      aiOutput.fullMarkdown,
      aiOutput.mermaidDiagram ?? ''
    );
    if (!validation.ok) {
      throw new Error(`validation failed: ${validation.reasons.join('; ')}`);
    }

    const upload = await uploadMarkdownVersioned(
      aiOutput.fullMarkdown,
      doc.slug,
      doc.version + 1
    );
    uploadedPublicId = upload.publicId;

    const result = await promoteDoc({
      docId: doc._id,
      preCurrentPublicId: doc.currentPublicId,
      prePreviousPublicIds: doc.previousPublicIds ?? [],
      cloudinaryUrl: upload.secureUrl,
      newPublicId: upload.publicId,
      commitSha,
      etag: outcome.etag,
      pipelineVersion: PIPELINE_VERSION,
    });
    uploadedPublicId = null;

    return NextResponse.json({
      status: 'regenerated',
      slug: doc.slug,
      version: result.version,
      cached: false,
    });
  } catch (err) {
    if (uploadedPublicId) {
      await destroyPublicId(uploadedPublicId);
    }
    await recordRegenFailure(doc._id, userId, err);
    console.error(
      '[/api/generate:regen]',
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({
      status: 'stale',
      slug: doc.slug,
      reason: 'regeneration_failed',
    });
  } finally {
    await releaseLock(doc._id, userId);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as { repoUrl?: unknown };
    const repoUrl = typeof body.repoUrl === 'string' ? body.repoUrl.trim() : '';

    if (!repoUrl) {
      return NextResponse.json({ error: 'repoUrl is required' }, { status: 400 });
    }

    let owner: string;
    let repo: string;
    let repoKey: string;
    try {
      ({ owner, repo, repoKey } = canonicalizeRepoUrl(repoUrl));
    } catch {
      return NextResponse.json({ error: 'Invalid GitHub repository URL' }, { status: 400 });
    }

    await connectDB();

    // ── Cache check (core architectural constraint) ──────────────────────────
    // Look up by repoKey first; on miss, resolve the durable repoId (rename case).
    let existing = (await GeneratedDocModel.findOne({ repoKey }).lean()) as
      | LeanDoc
      | null;
    let resolved: ResolvedRepo | null = null;
    if (!existing) {
      resolved = await resolveRepo(owner, repo);
      existing = (await GeneratedDocModel.findOne({
        repoId: resolved.repoId,
      }).lean()) as LeanDoc | null;
    }

    if (existing) {
      const outcome = await evaluateExisting(existing);
      if (outcome.action === 'serve_cached') {
        return NextResponse.json({
          status: 'cached',
          slug: existing.slug,
          cached: true,
        });
      }

      const resolvedRepo = resolved ?? (await resolveRepo(owner, repo));
      return await regenerateExisting(
        existing,
        resolvedRepo,
        outcome,
        session.user.id
      );
    }

    // ── Cache miss: full initial generation ─────────────────────────────────
    const resolvedRepo = resolved ?? (await resolveRepo(owner, repo));

    const dbUser = await UserModel.findById(session.user.id);
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { hasByok, userApiKeys } = await resolveByokKeys(dbUser);
    if (!checkQuota(dbUser, hasByok)) {
      return NextResponse.json(
        {
          error: `Daily free limit reached (${FREE_TIER_DAILY_LIMIT}/day). Add your own API keys for unlimited access.`,
          limitReached: true,
        },
        { status: 429 }
      );
    }

    // ── Pin the HEAD sha before ingestion, then fetch repo files ─────────────
    const commitSha = await fetchHeadCommitSha(
      resolvedRepo.owner,
      resolvedRepo.repo,
      resolvedRepo.defaultBranch
    );
    const { fileTree, keyFiles } = await fetchRepoFiles(
      resolvedRepo.owner,
      resolvedRepo.repo,
      { ref: commitSha, sizeKb: resolvedRepo.sizeKb }
    );

    // ── Generate documentation ────────────────────────────────────────────────
    const aiOutput = await generateDocumentation({
      fileTree,
      keyFiles,
      userApiKeys: userApiKeys.length > 0 ? userApiKeys : undefined,
    });
    await incrementQuota(dbUser, hasByok);

    // ── Upload to Cloudinary ──────────────────────────────────────────────────
    const slug = generateSlug(resolvedRepo.owner, resolvedRepo.repo);
    const upload = await uploadMarkdownVersioned(aiOutput.fullMarkdown, slug, 1);

    // ── Persist metadata ──────────────────────────────────────────────────────
    await GeneratedDocModel.create({
      repoUrl: `https://github.com/${resolvedRepo.owner}/${resolvedRepo.repo}`,
      repoName: resolvedRepo.repo,
      repoOwner: resolvedRepo.owner,
      repoId: resolvedRepo.repoId,
      repoKey: resolvedRepo.repoKey,
      defaultBranch: resolvedRepo.defaultBranch,
      slug,
      cloudinaryUrl: upload.secureUrl,
      commitSha,
      lastKnownHeadSha: commitSha,
      commitsBehind: 0,
      lastCheckedAt: new Date(),
      version: 1,
      pipelineVersion: PIPELINE_VERSION,
      status: 'ready',
      currentPublicId: upload.publicId,
      previousPublicIds: [],
      failureCount: 0,
      createdBy: dbUser._id,
      viewCount: 0,
    });

    return NextResponse.json({ status: 'created', slug, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('[/api/generate]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
