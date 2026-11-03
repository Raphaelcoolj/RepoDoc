import { POST } from '../app/api/generate/route';
import { NextRequest } from 'next/server';
import GeneratedDocModel from '../models/GeneratedDoc';
import UserModel from '../models/User';
import * as github from '../lib/github';
import * as ai from '../lib/ai';
import * as cloudinary from '../lib/cloudinary';
import * as freshness from '../lib/freshness';
import { auth } from '../auth';

// Mock everything
jest.mock('../models/GeneratedDoc');
jest.mock('../models/User');
jest.mock('../lib/github');
jest.mock('../lib/ai');
jest.mock('../lib/cloudinary');
jest.mock('../lib/freshness');
jest.mock('../auth', () => ({ auth: jest.fn() }));
jest.mock('../lib/db', () => ({
  connectDB: jest.fn(),
}));

const RESOLVED = {
  repoId: 12345,
  owner: 'o',
  repo: 'r',
  repoKey: 'o/r',
  defaultBranch: 'main',
  sizeKb: 10,
};

const HEAD_SHA = 'a'.repeat(40);

function leanResult(value: unknown): { lean: () => Promise<unknown> } {
  return { lean: () => Promise.resolve(value) };
}

describe('Doc Generation Pipeline Integration', () => {
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
    (auth as jest.Mock).mockResolvedValue({ user: { id: 'user123' } });
    (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'unchanged',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# fine, no failure markers'),
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  function post(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  test('CACHE HIT: should return existing doc without calling AI or GitHub', async () => {
    const existingDoc = {
      _id: 'doc1',
      slug: 'cached-slug',
      repoUrl: 'https://github.com/o/r',
      repoKey: 'o/r',
      cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/repodoc/repodoc/cached-slug',
    };
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(existingDoc));

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(data.slug).toBe('cached-slug');
    expect(data.cached).toBe(true);
    expect(github.resolveRepo).not.toHaveBeenCalled();
    expect(github.fetchRepoFiles).not.toHaveBeenCalled();
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
  });

  test('CACHE HIT after rename: resolves repoId and serves cached doc', async () => {
    const existingDoc = {
      _id: 'doc1',
      slug: 'renamed-slug',
      repoUrl: 'https://github.com/new-owner/r',
      repoKey: 'new-owner/r',
      cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/repodoc/repodoc/renamed-slug',
    };
    (GeneratedDocModel.findOne as jest.Mock).mockImplementation(
      (query: Record<string, unknown>) =>
        leanResult('repoKey' in query ? null : existingDoc)
    );
    (github.resolveRepo as jest.Mock).mockResolvedValue({
      ...RESOLVED,
      owner: 'new-owner',
      repoKey: 'new-owner/r',
    });

    const res = await POST(post({ repoUrl: 'https://github.com/new-owner/r' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.slug).toBe('renamed-slug');
    expect(data.cached).toBe(true);
    expect(github.resolveRepo).toHaveBeenCalledWith('new-owner', 'r');
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
  });

  test('CACHE MISS: should run full pipeline if doc does not exist', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(null));
    (github.resolveRepo as jest.Mock).mockResolvedValue(RESOLVED);
    (github.fetchHeadCommitSha as jest.Mock).mockResolvedValue(HEAD_SHA);
    (github.fetchRepoFiles as jest.Mock).mockResolvedValue({ fileTree: '', keyFiles: {} });
    (ai.generateDocumentation as jest.Mock).mockResolvedValue({ fullMarkdown: '# Docs' });
    (cloudinary.uploadMarkdownVersioned as jest.Mock).mockResolvedValue({
      secureUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/new-slug/v1',
      publicId: 'docs/new-slug/v1',
    });
    (GeneratedDocModel.create as jest.Mock).mockResolvedValue({});

    const res = await POST(post({ repoUrl: 'https://github.com/o/r' }));
    const data = await res.json();

    expect(data.status).toBe('created');
    expect(data.cached).toBe(false);
    expect(data.slug).toBeTruthy();
    expect(github.fetchRepoFiles).toHaveBeenCalled();
    expect(ai.generateDocumentation).toHaveBeenCalled();
    expect(cloudinary.uploadMarkdownVersioned).toHaveBeenCalled();

    const created = (GeneratedDocModel.create as jest.Mock).mock.calls[0][0];
    expect(created.repoId).toBe(12345);
    expect(created.repoKey).toBe('o/r');
    expect(created.defaultBranch).toBe('main');
    expect(created.commitSha).toBe(HEAD_SHA);
    expect(created.version).toBe(1);
    expect(created.pipelineVersion).toBeGreaterThanOrEqual(1);
    expect(created.status).toBe('ready');
    expect(created.failureCount).toBe(0);
    expect(created.currentPublicId).toBe('docs/new-slug/v1');
    expect(Array.isArray(created.previousPublicIds)).toBe(true);

    // HEAD sha captured before ingestion
    const headOrder = [
      (github.fetchHeadCommitSha as jest.Mock).mock.invocationCallOrder[0],
      (github.fetchRepoFiles as jest.Mock).mock.invocationCallOrder[0],
    ];
    expect(headOrder[0]).toBeLessThan(headOrder[1]);
  });

  test('RATE LIMIT: should block if free tier limit reached and no BYOK', async () => {
    (GeneratedDocModel.findOne as jest.Mock).mockReturnValue(leanResult(null));
    (github.resolveRepo as jest.Mock).mockResolvedValue(RESOLVED);
    const limitUser = { ...mockUser, freeDocsUsed: 3 };
    (UserModel.findById as jest.Mock).mockResolvedValue(limitUser);

    const res = await POST(post({ repoUrl: 'https://github.com/o/new' }));
    const data = await res.json();

    expect(res.status).toBe(429);
    expect(data.error).toContain('limit reached');
    expect(ai.generateDocumentation).not.toHaveBeenCalled();
    expect(github.fetchHeadCommitSha).not.toHaveBeenCalled();
  });
});
