import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getHeadSha, classifyChange } from '@/lib/freshness';
import GeneratedDocModel from '@/models/GeneratedDoc';
import type { Types } from 'mongoose';

interface LeanDoc {
  _id: Types.ObjectId;
  slug: string;
  repoKey: string;
  repoId: number;
  defaultBranch: string;
  commitSha?: string;
  etag?: string;
  lastKnownHeadSha?: string;
  commitsBehind?: number;
  lastCheckedAt?: Date;
  lastRegeneratedAt?: Date;
  status: string;
  version: number;
}

function withCache(body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, max-age=30' },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await params;

  try {
    await connectDB();
    const doc = (await GeneratedDocModel.findOne({ slug }).lean()) as
      | LeanDoc
      | null;

    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const base = {
      lastRegeneratedAt: doc.lastRegeneratedAt?.toISOString() ?? null,
      lastCheckedAt: doc.lastCheckedAt?.toISOString() ?? null,
      version: doc.version,
    };

    if (doc.status === 'generating') {
      return withCache({ ...base, status: 'regenerating' });
    }

    if (!doc.commitSha) {
      // Legacy doc without a baseline: freshness cannot be established.
      return withCache({ ...base, status: 'unknown' });
    }

    const head = await getHeadSha({
      docId: doc._id,
      repoId: doc.repoId,
      repoKey: doc.repoKey,
      defaultBranch: doc.defaultBranch,
      etag: doc.etag,
    });

    if (head.status === 'github_unavailable') {
      return withCache({ ...base, status: 'unknown' });
    }
    if (head.status === 'source_unavailable') {
      return withCache({ ...base, status: 'source_unavailable' });
    }

    if (head.status === 'unchanged') {
      const behind =
        !!doc.lastKnownHeadSha && doc.lastKnownHeadSha !== doc.commitSha;
      if (!behind) {
        return withCache({ ...base, status: 'up_to_date', commitsBehind: 0 });
      }
      return withCache({
        ...base,
        status: 'behind',
        ...(typeof doc.commitsBehind === 'number'
          ? { commitsBehind: doc.commitsBehind }
          : {}),
      });
    }

    if (head.sha === doc.commitSha) {
      return withCache({ ...base, status: 'up_to_date', commitsBehind: 0 });
    }

    const classify = await classifyChange(doc.repoKey, doc.commitSha, head.sha);
    if (classify.status === 'github_unavailable') {
      return withCache({ ...base, status: 'unknown' });
    }

    return withCache({
      ...base,
      status: 'behind',
      commitsBehind: classify.commitsBehind,
    });
  } catch (err) {
    console.error(
      '[/api/doc/freshness]',
      err instanceof Error ? err.message : err
    );
    // Fail-open: the banner simply reports that freshness is unknown.
    return NextResponse.json({ status: 'unknown' });
  }
}
