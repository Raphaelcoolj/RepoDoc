import { startMongo, stopMongo, clearDb } from './helpers/mongo';
import { Types } from 'mongoose';
import GeneratedDocModel, { IGeneratedDoc } from '../models/GeneratedDoc';
import {
  promoteDoc,
  recordRegenFailure,
  sanitizeError,
} from '../lib/promote';
import { destroyPublicId } from '../lib/cloudinary';
import { PIPELINE_VERSION } from '../lib/pipelineVersion';

jest.mock('../lib/cloudinary', () => ({
  destroyPublicId: jest.fn().mockResolvedValue(undefined),
  uploadMarkdownVersioned: jest.fn(),
  uploadMarkdown: jest.fn(),
  fetchMarkdownFromUrl: jest.fn(),
  publicIdFromCloudinaryUrl: jest.fn(),
}));

const destroyMock = destroyPublicId as jest.Mock;

async function makeDoc(
  overrides: Partial<IGeneratedDoc> = {}
): Promise<IGeneratedDoc> {
  return GeneratedDocModel.create({
    repoUrl: 'https://github.com/octocat/Hello-World',
    repoName: 'Hello-World',
    repoOwner: 'octocat',
    repoId: 1296269,
    repoKey: 'octocat/hello-world',
    defaultBranch: 'master',
    slug: 'hello-world',
    cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/hello-world/v1',
    commitSha: 'old-sha',
    version: 1,
    pipelineVersion: PIPELINE_VERSION,
    currentPublicId: 'docs/hello-world/v1',
    previousPublicIds: [],
    createdBy: new Types.ObjectId(),
    ...overrides,
  });
}

beforeAll(async () => {
  await startMongo();
});

afterAll(async () => {
  await stopMongo();
});

beforeEach(async () => {
  await clearDb();
  destroyMock.mockClear();
});

describe('promoteDoc', () => {
  it('atomically bumps version, sets ready, and rotates the current id', async () => {
    const doc = await makeDoc();

    const result = await promoteDoc({
      docId: doc._id as Types.ObjectId,
      preCurrentPublicId: 'docs/hello-world/v1',
      prePreviousPublicIds: [],
      cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/hello-world/v2',
      newPublicId: 'docs/hello-world/v2',
      commitSha: 'new-sha',
      etag: 'W/"deadbeef"',
      pipelineVersion: PIPELINE_VERSION,
    });

    expect(result.version).toBe(2);
    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.version).toBe(2);
    expect(fresh!.status).toBe('ready');
    expect(fresh!.currentPublicId).toBe('docs/hello-world/v2');
    expect(fresh!.previousPublicIds).toEqual(['docs/hello-world/v1']);
    expect(fresh!.commitSha).toBe('new-sha');
    expect(fresh!.etag).toBe('W/"deadbeef"');
    expect(fresh!.lastRegeneratedAt).toBeInstanceOf(Date);
    expect(destroyMock).not.toHaveBeenCalled();
  });

  it('keeps exactly one previous id and destroys the one that falls out', async () => {
    const doc = await makeDoc({
      currentPublicId: 'docs/hello-world/v3',
      previousPublicIds: ['docs/hello-world/v2'],
      version: 3,
    });

    const result = await promoteDoc({
      docId: doc._id as Types.ObjectId,
      preCurrentPublicId: 'docs/hello-world/v3',
      prePreviousPublicIds: ['docs/hello-world/v2'],
      cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/hello-world/v4',
      newPublicId: 'docs/hello-world/v4',
      commitSha: 'sha-4',
      pipelineVersion: PIPELINE_VERSION,
    });

    expect(result.version).toBe(4);
    expect(result.droppedPublicIds).toEqual(['docs/hello-world/v2']);
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledWith('docs/hello-world/v2');

    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.previousPublicIds).toEqual(['docs/hello-world/v3']);
  });

  it('clears failure bookkeeping and the lock', async () => {
    const user = new Types.ObjectId();
    const doc = await makeDoc({
      status: 'generating',
      lockedAt: new Date(),
      lockedBy: user,
      failureCount: 2,
      lastError: 'previous failure',
    });

    await promoteDoc({
      docId: doc._id as Types.ObjectId,
      preCurrentPublicId: 'docs/hello-world/v1',
      prePreviousPublicIds: [],
      cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/hello-world/v2',
      newPublicId: 'docs/hello-world/v2',
      commitSha: 'new-sha',
      pipelineVersion: PIPELINE_VERSION,
    });

    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.status).toBe('ready');
    expect(fresh!.failureCount).toBe(0);
    expect(fresh!.lastError).toBeUndefined();
    expect(fresh!.lockedAt).toBeUndefined();
    expect(fresh!.lockedBy).toBeUndefined();
  });

  it('unsets etag when the caller has none', async () => {
    const doc = await makeDoc({ etag: 'W/"stale"' });

    await promoteDoc({
      docId: doc._id as Types.ObjectId,
      preCurrentPublicId: 'docs/hello-world/v1',
      prePreviousPublicIds: [],
      cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/hello-world/v2',
      newPublicId: 'docs/hello-world/v2',
      commitSha: 'new-sha',
      pipelineVersion: PIPELINE_VERSION,
    });

    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.etag).toBeUndefined();
  });

  it('throws when the document is gone', async () => {
    await expect(
      promoteDoc({
        docId: new Types.ObjectId(),
        preCurrentPublicId: 'docs/hello-world/v1',
        prePreviousPublicIds: [],
        cloudinaryUrl: 'https://example.com/v2',
        newPublicId: 'docs/hello-world/v2',
        commitSha: 'new-sha',
        pipelineVersion: PIPELINE_VERSION,
      })
    ).rejects.toThrow('promote failed');
  });
});

describe('recordRegenFailure', () => {
  it('increments failureCount, sets ready, and sanitizes the error', async () => {
    const user = new Types.ObjectId();
    const doc = await makeDoc({
      status: 'generating',
      lockedAt: new Date(),
      lockedBy: user,
      failureCount: 1,
    });

    await recordRegenFailure(
      doc._id as Types.ObjectId,
      user,
      new Error('boom with sk-abc123456789 and Bearer supersecrettoken')
    );

    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.status).toBe('ready');
    expect(fresh!.failureCount).toBe(2);
    expect(fresh!.lastRegenAttemptAt).toBeInstanceOf(Date);
    expect(fresh!.lockedAt).toBeUndefined();
    expect(fresh!.lockedBy).toBeUndefined();
    expect(fresh!.lastError).not.toContain('sk-abc123456789');
    expect(fresh!.lastError).not.toContain('supersecrettoken');
    expect(fresh!.lastError).toContain('[redacted]');
    expect(fresh!.lastError).toContain('boom');
  });

  it('does not touch a doc whose lock moved to another holder', async () => {
    const user = new Types.ObjectId();
    const other = new Types.ObjectId();
    const doc = await makeDoc({
      status: 'generating',
      lockedAt: new Date(),
      lockedBy: other,
      failureCount: 0,
    });

    await recordRegenFailure(doc._id as Types.ObjectId, user, new Error('nope'));

    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.status).toBe('generating');
    expect(fresh!.failureCount).toBe(0);
    expect(fresh!.lastError).toBeUndefined();
  });
});

describe('sanitizeError', () => {
  it('redacts common secret shapes', () => {
    const out = sanitizeError(
      new Error(
        'key sk-1234567890abcd token ghp_abcdefghij123456 Bearer abc.def.ghi AIzaSyExample12345'
      )
    );
    expect(out).not.toContain('sk-1234567890abcd');
    expect(out).not.toContain('ghp_abcdefghij123456');
    expect(out).not.toContain('abc.def.ghi');
    expect(out).not.toContain('AIzaSyExample12345');
    expect(out).toContain('[redacted]');
  });

  it('truncates very long messages', () => {
    const out = sanitizeError(new Error('x'.repeat(2000)));
    expect(out.length).toBeLessThanOrEqual(401);
  });

  it('handles non-error values', () => {
    expect(sanitizeError('plain string')).toBe('plain string');
    expect(sanitizeError({ code: 5 })).toBe('{"code":5}');
    expect(sanitizeError(undefined)).toBe('Unknown error');
  });
});
