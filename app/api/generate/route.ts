import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { connectDB } from '@/lib/db';
import { fetchRepoFiles, parseRepoUrl } from '@/lib/github';
import { generateDocumentation } from '@/lib/ai';
import { uploadMarkdown } from '@/lib/cloudinary';
import { decrypt } from '@/lib/crypto';
import GeneratedDocModel from '@/models/GeneratedDoc';
import UserModel from '@/models/User';
import slugify from 'slugify';
import crypto from 'crypto';

const FREE_TIER_DAILY_LIMIT = 999;

function generateSlug(owner: string, repo: string): string {
  const base = slugify(`${owner}-${repo}`, { lower: true, strict: true });
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { repoUrl?: unknown };
    const repoUrl = typeof body.repoUrl === 'string' ? body.repoUrl.trim() : '';

    if (!repoUrl) {
      return NextResponse.json({ error: 'repoUrl is required' }, { status: 400 });
    }

    let owner: string;
    let repo: string;
    try {
      ({ owner, repo } = parseRepoUrl(repoUrl));
    } catch {
      return NextResponse.json({ error: 'Invalid GitHub repository URL' }, { status: 400 });
    }

    await connectDB();

    // ── Cache check (core architectural constraint) ──────────────────────────
    const existing = await GeneratedDocModel.findOne({ repoUrl }).lean();
    if (existing) {
      // Fetch the content from Cloudinary to check for failure markers
      try {
        const res = await fetch(existing.cloudinaryUrl);
        const text = await res.text();
        if (!text.includes('[Generation failed for this section]')) {
          return NextResponse.json({ slug: existing.slug, cached: true });
        }
        // If it was a failure, we proceed to re-generate (deleting the old one first)
        await GeneratedDocModel.deleteOne({ _id: existing._id });
      } catch {
        // If fetch fails, assume valid or proceed
        return NextResponse.json({ slug: existing.slug, cached: true });
      }
    }

    // ── Fetch the user and resolve BYOK keys ─────────────────────────────────
    const dbUser = await UserModel.findById(session.user.id);
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const hasByok =
      dbUser.apiKeys?.provider1?.key || dbUser.apiKeys?.provider2?.key;

    // ── Free tier rate limiting ───────────────────────────────────────────────
    if (!hasByok) {
      const now = new Date();
      const resetAt = new Date(dbUser.freeDocsResetAt);
      const oneDayMs = 24 * 60 * 60 * 1000;

      if (now.getTime() - resetAt.getTime() >= oneDayMs) {
        dbUser.freeDocsUsed = 0;
        dbUser.freeDocsResetAt = now;
      }

      if (dbUser.freeDocsUsed >= FREE_TIER_DAILY_LIMIT) {
        return NextResponse.json(
          {
            error: 'Daily free limit reached (3/day). Add your own API keys for unlimited access.',
            limitReached: true,
          },
          { status: 429 }
        );
      }
    }

    // ── Decrypt BYOK keys for injection ──────────────────────────────────────
    const userApiKeys: { name: string; key: string }[] = [];
    if (hasByok) {
      for (const slot of ['provider1', 'provider2'] as const) {
        const entry = dbUser.apiKeys?.[slot];
        if (entry?.key) {
          try {
            userApiKeys.push({ name: entry.name, key: decrypt(entry.key) });
          } catch {
            // Skip malformed encrypted keys
          }
        }
      }
    }

    // ── Fetch repo files ──────────────────────────────────────────────────────
    const { fileTree, keyFiles } = await fetchRepoFiles(owner, repo);

    // ── Generate documentation ────────────────────────────────────────────────
    const aiOutput = await generateDocumentation({
      fileTree,
      keyFiles,
      userApiKeys: userApiKeys.length > 0 ? userApiKeys : undefined,
    });

    // ── Upload to Cloudinary ──────────────────────────────────────────────────
    const slug = generateSlug(owner, repo);
    const cloudinaryPublicId = `repodoc/${slug}`;
    const cloudinaryUrl = await uploadMarkdown(aiOutput.fullMarkdown, cloudinaryPublicId);

    // ── Persist metadata ──────────────────────────────────────────────────────
    await GeneratedDocModel.create({
      repoUrl,
      repoName: repo,
      repoOwner: owner,
      slug,
      cloudinaryUrl,
      createdBy: dbUser._id,
      viewCount: 0,
    });

    // ── Increment free tier usage ─────────────────────────────────────────────
    if (!hasByok) {
      dbUser.freeDocsUsed += 1;
      await dbUser.save();
    }

    return NextResponse.json({ slug, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('[/api/generate]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
