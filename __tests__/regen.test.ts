import { POST } from '../app/api/generate/route';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import GeneratedDocModel from '../models/GeneratedDoc';
import UserModel from '../models/User';
import * as github from '../lib/github';
import * as ai from '../lib/ai';
import * as cloudinary from '../lib/cloudinary';
import * as freshness from '../lib/freshness';
import * as docLock from '../lib/docLock';
import * as promote from '../lib/promote';
import { auth } from '../auth';

jest.mock('../models/GeneratedDoc');
jest.mock('../models/User');
jest.mock('../lib/github');
jest.mock('../lib/ai');
jest.mock('../lib/cloudinary');
jest.mock('../lib/freshness');
jest.mock('../lib/docLock');
jest.mock('../lib/promote');
jest.mock('../auth', () => ({ auth: jest.fn() }));
jest.mock('../lib/db', () => ({ connectDB: jest.fn() }));

const USER_ID = '64b000000000000000000009';
const OLD_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);

const RESOLVED = {
  repoId: 12345,
  owner: 'o',
  repo: 'r',
  repoKey: 'o/r',
  defaultBranch: 'main',
  sizeKb: 10,
};

const DOC = {
  _id: new Types.ObjectId('64b000000000000000000001'),
  slug: 'o-r-abc123',
  cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/o-r-abc123/v1',
  repoKey: 'o/r',
  repoId: 12345,
  defaultBranch: 'main',
  commitSha: OLD_SHA,
  etag: 'W/"old"',
  version: 1,
  currentPublicId: 'docs/o-r-abc123/v1',
  previousPublicIds: [] as string[],
  status: 'ready',
};

function leanResult(value: unknown): { lean: () => Promise<unknown> } {
  return { lean: () => Promise.resolve(value) };
}

function validMarkdown(): string {
  return [
    '# Project Documentation',
    '',
    '## 🚀 1. Overview',
    '',
    'This repository generates documentation from source. '.repeat(6),
    '',
    '## 📂 2. Project Structure',
    '',
    '```',
    'src/',
    '  index.ts',
    '```',
    '',
    '## 🏗️ 3. Architecture & Data Flow',
    '',
    'A pipeline ingests the repository and renders markdown. '.repeat(5),
    '',
    '## 🛠️ 4. Function Breakdowns',
    '',
    '| Function | Purpose |',
    '| --- | --- |',
    '| generate | runs the pipeline |',
    '',
  ].join('\n');
}

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate — regeneration orchestration', () => {
  const originalFetch = global.fetch;

  const mockUser = {
    _id: 'user123',
    freeDocsUsed: 0,
    freeDocsResetAt: new Date(),
    apiKeys: {},
    save: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.freeDocsUsed = 0;
    (auth as jest.Mock).mockResolvedValue({ user: { id: USER_ID } });
    (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(DOC));
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'unchanged',
    });
    (freshness.classifyChange as jest.Mock).mockResolvedValue({
      status: 'ok',
      significant: true,
      commitsBehind: 5,
      changedFiles: 12,
    });
    (github.resolveRepo as jest.Mock).mockResolvedValue(RESOLVED);
    (github.fetchHeadCommitSha as jest.Mock).mockResolvedValue(NEW_SHA);
    (github.fetchRepoFiles as jest.Mock).mockResolvedValue({
      fileTree: '',
      keyFiles: {},
    });
    (ai.generateDocumentation as jest.Mock).mockResolvedValue({
      fullMarkdown: validMarkdown(),
      mermaidDiagram: 'graph TD\n  A --> B',
    });
    (cloudinary.uploadMarkdownVersioned as jest.Mock).mockResolvedValue({
      secureUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/o-r-abc123/v2',
      publicId: 'docs/o-r-abc123/v2',
    });
    (docLock.acquireLock as jest.Mock).mockResolvedValue({
      ...DOC,
      status: 'generating',
    });
    (docLock.releaseLock as jest.Mock).mockResolvedValue(undefined);
    (promote.promoteDoc as jest.Mock).mockResolvedValue({
      version: 2,
      droppedPublicIds: [],
    });
    (promote.recordRegenFailure as jest.Mock).mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# fine, no failure markers'),
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('serves cached when GitHub is unavailable (fail-open)', async () => {
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'github_unavailable',
    });

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ status: 'cached', slug: 'o-r-abc123', cached: true });
    expect(freshness.classifyChange).not.toHaveBeenCalled();
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
    expect(github.resolveRepo).not.toHaveBeenCalled();
  });

  it('serves cached when the head is unchanged (304)', async () => {
    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(data.status).toBe('cached');
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
    expect(GeneratedDocModel.updateOne).toHaveBeenCalledWith(
      { _id: DOC._id },
      { $set: { lastCheckedAt: expect.any(Date) } }
    );
  });

  it('serves cached on an insignificant change and records the etag', async () => {
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"new"',
    });
    (freshness.classifyChange as jest.Mock).mockResolvedValue({
      status: 'ok',
      significant: false,
      commitsBehind: 2,
      changedFiles: 1,
    });

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(data.status).toBe('cached');
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
    expect(docLock.acquireLock).not.toHaveBeenCalled();
    expect(GeneratedDocModel.updateOne).toHaveBeenCalledWith(
      { _id: DOC._id },
      {
        $set: {
          lastKnownHeadSha: NEW_SHA,
          commitsBehind: 2,
          lastCheckedAt: expect.any(Date),
          etag: 'W/"new"',
        },
      }
    );
  });

  it('regenerates on a significant change and returns the new version', async () => {
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"new"',
    });

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      status: 'regenerated',
      slug: 'o-r-abc123',
      version: 2,
      cached: false,
    });

    expect(docLock.acquireLock).toHaveBeenCalledWith(DOC._id, expect.any(Types.ObjectId));
    expect(github.fetchRepoFiles).toHaveBeenCalledWith('o', 'r', {
      ref: NEW_SHA,
      sizeKb: 10,
    });
    expect(ai.generateDocumentation).toHaveBeenCalled();
    expect(cloudinary.uploadMarkdownVersioned).toHaveBeenCalledWith(
      expect.stringContaining('# Project Documentation'),
      'o-r-abc123',
      2
    );
    expect(promote.promoteDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: DOC._id,
        preCurrentPublicId: 'docs/o-r-abc123/v1',
        prePreviousPublicIds: [],
        newPublicId: 'docs/o-r-abc123/v2',
        commitSha: NEW_SHA,
        etag: 'W/"new"',
      })
    );
    expect(docLock.releaseLock).toHaveBeenCalledWith(
      DOC._id,
      expect.any(Types.ObjectId)
    );
    expect(mockUser.save).toHaveBeenCalled();
  });

  it('returns regenerating without running the pipeline when the lock is busy', async () => {
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"new"',
    });
    (docLock.acquireLock as jest.Mock).mockResolvedValue(null);

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ status: 'regenerating', slug: 'o-r-abc123' });
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
    expect(docLock.releaseLock).not.toHaveBeenCalled();
    expect(promote.recordRegenFailure).not.toHaveBeenCalled();
  });

  it('fails stale on validation failure without uploading', async () => {
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"new"',
    });
    (ai.generateDocumentation as jest.Mock).mockResolvedValue({
      fullMarkdown: '# Project Documentation\n\ntoo short',
      mermaidDiagram: '',
    });

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      status: 'stale',
      slug: 'o-r-abc123',
      reason: 'regeneration_failed',
    });
    expect(cloudinary.uploadMarkdownVersioned).not.toHaveBeenCalled();
    expect(cloudinary.destroyPublicId).not.toHaveBeenCalled();
    expect(promote.recordRegenFailure).toHaveBeenCalledWith(
      DOC._id,
      expect.any(Types.ObjectId),
      expect.objectContaining({ message: expect.stringContaining('validation failed') })
    );
    expect(docLock.releaseLock).toHaveBeenCalledWith(
      DOC._id,
      expect.any(Types.ObjectId)
    );
    expect(promote.promoteDoc).not.toHaveBeenCalled();
  });

  it('destroys the orphan upload when promote fails', async () => {
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"new"',
    });
    (promote.promoteDoc as jest.Mock).mockRejectedValue(
      new Error('db write failed')
    );

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(data.status).toBe('stale');
    expect(cloudinary.destroyPublicId).toHaveBeenCalledWith('docs/o-r-abc123/v2');
    expect(promote.recordRegenFailure).toHaveBeenCalledWith(
      DOC._id,
      expect.any(Types.ObjectId),
      expect.objectContaining({ message: 'db write failed' })
    );
    expect(docLock.releaseLock).toHaveBeenCalled();
  });

  it('blocks a free-tier regeneration at the daily limit before locking', async () => {
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"new"',
    });
    (UserModel.findById as jest.Mock).mockResolvedValue({
      ...mockUser,
      freeDocsUsed: 3,
    });

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.limitReached).toBe(true);
    expect(docLock.acquireLock).not.toHaveBeenCalled();
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
  });

  it('regenerates a marker-broken doc without a freshness check', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('broken [Generation failed for this section]'),
    }) as unknown as typeof fetch;

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(data.status).toBe('regenerated');
    expect(freshness.getHeadSha).not.toHaveBeenCalled();
    expect(github.fetchHeadCommitSha).toHaveBeenCalledWith('o', 'r', 'main');
    expect(promote.promoteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ commitSha: NEW_SHA, etag: undefined })
    );
  });

  it('regenerates a legacy doc that has no baseline sha', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(
      leanResult({ ...DOC, commitSha: undefined, etag: undefined })
    );
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"fresh"',
    });

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(data.status).toBe('regenerated');
    expect(freshness.classifyChange).not.toHaveBeenCalled();
    expect(github.fetchRepoFiles).toHaveBeenCalledWith('o', 'r', {
      ref: NEW_SHA,
      sizeKb: 10,
    });
    expect(promote.promoteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ commitSha: NEW_SHA, etag: 'W/"fresh"' })
    );
  });
});
