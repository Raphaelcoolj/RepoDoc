import { startMongo, stopMongo, clearDb } from './helpers/mongo';
import { POST } from '../app/api/generate/route';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import GeneratedDocModel, { IGeneratedDoc } from '../models/GeneratedDoc';
import UserModel, { IUser } from '../models/User';
import * as github from '../lib/github';
import * as ai from '../lib/ai';
import * as cloudinary from '../lib/cloudinary';
import * as freshness from '../lib/freshness';
import { auth } from '../auth';

jest.mock('../auth', () => ({ auth: jest.fn() }));
jest.mock('../lib/github');
jest.mock('../lib/ai');
jest.mock('../lib/cloudinary');
jest.mock('../lib/freshness');

const OLD_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);
const NEW2_SHA = 'c'.repeat(40);

const RESOLVED = {
  repoId: 77777,
  owner: 'int',
  repo: 'repo',
  repoKey: 'int/repo',
  defaultBranch: 'main',
  sizeKb: 10,
};

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

function post(repoUrl = 'https://github.com/int/repo'): NextRequest {
  return new NextRequest('http://localhost/api/generate', {
    method: 'POST',
    body: JSON.stringify({ repoUrl }),
  });
}

async function makeUser(overrides: Partial<IUser> = {}): Promise<IUser> {
  return UserModel.create({
    name: 'Integration User',
    email: `int-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`,
    accounts: [],
    apiKeys: {},
    freeDocsUsed: 0,
    freeDocsResetAt: new Date(),
    onboardingComplete: true,
    ...overrides,
  });
}

async function makeDoc(
  user: IUser,
  overrides: Partial<IGeneratedDoc> = {}
): Promise<IGeneratedDoc> {
  return GeneratedDocModel.create({
    repoUrl: 'https://github.com/int/repo',
    repoName: 'repo',
    repoOwner: 'int',
    repoId: RESOLVED.repoId,
    repoKey: RESOLVED.repoKey,
    defaultBranch: 'main',
    slug: 'int-repo-doc',
    cloudinaryUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/int-repo-doc/v1',
    commitSha: OLD_SHA,
    etag: 'W/"old"',
    lastKnownHeadSha: OLD_SHA,
    commitsBehind: 0,
    version: 1,
    currentPublicId: 'docs/int-repo-doc/v1',
    previousPublicIds: [],
    status: 'ready',
    createdBy: user._id,
    ...overrides,
  });
}

describe('regeneration integration (real mongodb)', () => {
  const originalFetch = global.fetch;
  let user: IUser;
  let doc: IGeneratedDoc;

  beforeAll(async () => {
    await startMongo();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearDb();
    jest.clearAllMocks();

    user = await makeUser();
    doc = await makeDoc(user);

    (auth as jest.Mock).mockResolvedValue({
      user: { id: user._id.toString() },
    });
    (github.resolveRepo as jest.Mock).mockResolvedValue(RESOLVED);
    (github.fetchHeadCommitSha as jest.Mock).mockResolvedValue(NEW_SHA);
    (github.fetchRepoFiles as jest.Mock).mockResolvedValue({
      fileTree: '',
      keyFiles: {},
    });
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW_SHA,
      etag: 'W/"1"',
    });
    (freshness.classifyChange as jest.Mock).mockResolvedValue({
      status: 'ok',
      significant: true,
      commitsBehind: 5,
      changedFiles: 12,
    });
    (ai.generateDocumentation as jest.Mock).mockResolvedValue({
      fullMarkdown: validMarkdown(),
      mermaidDiagram: 'graph TD\n  A --> B',
    });
    (cloudinary.uploadMarkdownVersioned as jest.Mock).mockResolvedValue({
      secureUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/int-repo-doc/v2',
      publicId: 'docs/int-repo-doc/v2',
    });
    (cloudinary.destroyPublicId as jest.Mock).mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# fine, no failure markers'),
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function reloadDoc(): Promise<IGeneratedDoc> {
    const fresh = await GeneratedDocModel.findById(doc._id);
    if (!fresh) throw new Error('doc disappeared');
    return fresh;
  }

  it('runs exactly one pipeline when two requests race', async () => {
    (ai.generateDocumentation as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                fullMarkdown: validMarkdown(),
                mermaidDiagram: '',
              }),
            150
          )
        )
    );

    const [first, second] = await Promise.all([POST(post()), POST(post())]);
    const payloads = [await first.json(), await second.json()];
    const statuses = payloads.map((p) => p.status).sort();

    expect(statuses).toEqual(['regenerated', 'regenerating']);
    expect(ai.generateDocumentation).toHaveBeenCalledTimes(1);
    expect(cloudinary.uploadMarkdownVersioned).toHaveBeenCalledTimes(1);

    const after = await reloadDoc();
    expect(after.version).toBe(2);
    expect(after.status).toBe('ready');
    expect(after.lockedAt).toBeUndefined();
    expect(after.lockedBy).toBeUndefined();
  });

  it('takes over an expired lock and regenerates', async () => {
    await GeneratedDocModel.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'generating',
          lockedAt: new Date(Date.now() - 11 * 60_000),
          lockedBy: new Types.ObjectId(),
        },
      }
    );

    const res = await POST(post());
    const data = await res.json();

    expect(data.status).toBe('regenerated');
    expect(data.version).toBe(2);

    const after = await reloadDoc();
    expect(after.status).toBe('ready');
    expect(after.lockedAt).toBeUndefined();
    expect(after.version).toBe(2);
  });

  it('keeps the old doc intact when validation fails', async () => {
    (ai.generateDocumentation as jest.Mock).mockResolvedValue({
      fullMarkdown: '# Project Documentation\n\ntruncated',
      mermaidDiagram: '',
    });

    const res = await POST(post());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      status: 'stale',
      slug: 'int-repo-doc',
      reason: 'regeneration_failed',
    });
    expect(cloudinary.uploadMarkdownVersioned).not.toHaveBeenCalled();

    const after = await reloadDoc();
    expect(after.version).toBe(1);
    expect(after.currentPublicId).toBe('docs/int-repo-doc/v1');
    expect(after.cloudinaryUrl).toBe(
      'https://res.cloudinary.com/demo/raw/upload/docs/int-repo-doc/v1'
    );
    expect(after.commitSha).toBe(OLD_SHA);
    expect(after.status).toBe('ready');
    expect(after.failureCount).toBe(1);
    expect(after.lastError).toContain('validation failed');
    expect(after.lockedAt).toBeUndefined();
    expect(after.lockedBy).toBeUndefined();
  });

  it('destroys the orphan upload when the DB promote fails', async () => {
    const original = GeneratedDocModel.findOneAndUpdate.bind(
      GeneratedDocModel
    );
    const spy = jest
      .spyOn(GeneratedDocModel, 'findOneAndUpdate')
      .mockImplementation(((filter: Record<string, unknown>, ...rest: unknown[]) => {
        const keys = Object.keys(filter ?? {});
        if (keys.length === 1 && keys[0] === '_id') {
          return Promise.reject(new Error('db write failed')) as never;
        }
        return (original as (...args: unknown[]) => unknown)(
          filter,
          ...rest
        ) as never;
      }) as never);

    try {
      const res = await POST(post());
      const data = await res.json();

      expect(data.status).toBe('stale');
      expect(cloudinary.uploadMarkdownVersioned).toHaveBeenCalledTimes(1);
      expect(cloudinary.destroyPublicId).toHaveBeenCalledWith(
        'docs/int-repo-doc/v2'
      );

      const after = await reloadDoc();
      expect(after.version).toBe(1);
      expect(after.currentPublicId).toBe('docs/int-repo-doc/v1');
      expect(after.status).toBe('ready');
      expect(after.failureCount).toBe(1);
      expect(after.lastError).toContain('db write failed');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the slug stable across versions and rotates exactly one previous id', async () => {
    (freshness.getHeadSha as jest.Mock)
      .mockResolvedValueOnce({ status: 'ok', sha: NEW_SHA, etag: 'W/"1"' })
      .mockResolvedValueOnce({ status: 'ok', sha: NEW2_SHA, etag: 'W/"2"' });
    (cloudinary.uploadMarkdownVersioned as jest.Mock)
      .mockResolvedValueOnce({
        secureUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/int-repo-doc/v2',
        publicId: 'docs/int-repo-doc/v2',
      })
      .mockResolvedValueOnce({
        secureUrl: 'https://res.cloudinary.com/demo/raw/upload/docs/int-repo-doc/v3',
        publicId: 'docs/int-repo-doc/v3',
      });

    const first = await (await POST(post())).json();
    expect(first).toMatchObject({ status: 'regenerated', slug: 'int-repo-doc', version: 2 });

    let after = await reloadDoc();
    expect(after.slug).toBe('int-repo-doc');
    expect(after.version).toBe(2);
    expect(after.currentPublicId).toBe('docs/int-repo-doc/v2');
    expect(after.previousPublicIds).toEqual(['docs/int-repo-doc/v1']);
    expect(after.commitSha).toBe(NEW_SHA);
    expect(after.commitsBehind).toBe(0);
    expect(cloudinary.destroyPublicId).not.toHaveBeenCalled();

    const second = await (await POST(post())).json();
    expect(second).toMatchObject({ status: 'regenerated', slug: 'int-repo-doc', version: 3 });

    after = await reloadDoc();
    expect(after.slug).toBe('int-repo-doc');
    expect(after.version).toBe(3);
    expect(after.currentPublicId).toBe('docs/int-repo-doc/v3');
    expect(after.previousPublicIds).toEqual(['docs/int-repo-doc/v2']);
    expect(after.commitSha).toBe(NEW2_SHA);
    expect(after.etag).toBe('W/"2"');
    expect(after.failureCount).toBe(0);
    expect(after.lockedAt).toBeUndefined();
    expect(cloudinary.destroyPublicId).toHaveBeenCalledTimes(1);
    expect(cloudinary.destroyPublicId).toHaveBeenCalledWith(
      'docs/int-repo-doc/v1'
    );
  });

  it('serves the cached doc without locking when the change is insignificant', async () => {
    (freshness.classifyChange as jest.Mock).mockResolvedValue({
      status: 'ok',
      significant: false,
      commitsBehind: 2,
      changedFiles: 1,
    });

    const res = await POST(post());
    const data = await res.json();

    expect(data).toEqual({ status: 'cached', slug: 'int-repo-doc', cached: true });
    expect(ai.generateDocumentation).not.toHaveBeenCalled();

    const after = await reloadDoc();
    expect(after.version).toBe(1);
    expect(after.etag).toBe('W/"1"');
    expect(after.commitsBehind).toBe(2);
    expect(after.lastKnownHeadSha).toBe(NEW_SHA);
    expect(after.status).toBe('ready');
    expect(after.lockedAt).toBeUndefined();
  });

  it('consumes one free-tier credit only when the regeneration succeeds', async () => {
    const res = await POST(post());
    expect((await res.json()).status).toBe('regenerated');

    const afterUser = await UserModel.findById(user._id);
    expect(afterUser!.freeDocsUsed).toBe(1);

    // Failure does not double-charge beyond the AI call already billed:
    (freshness.getHeadSha as jest.Mock).mockResolvedValue({
      status: 'ok',
      sha: NEW2_SHA,
      etag: 'W/"2"',
    });
    (ai.generateDocumentation as jest.Mock).mockResolvedValue({
      fullMarkdown: 'nope',
      mermaidDiagram: '',
    });
    await POST(post());

    const failedUser = await UserModel.findById(user._id);
    expect(failedUser!.freeDocsUsed).toBe(2);
    const after = await reloadDoc();
    expect(after.version).toBe(2);
    expect(after.failureCount).toBe(1);
  });
});
