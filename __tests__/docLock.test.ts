import { startMongo, stopMongo, clearDb } from './helpers/mongo';
import { Types } from 'mongoose';
import GeneratedDocModel, { IGeneratedDoc } from '../models/GeneratedDoc';
import { acquireLock, releaseLock, getRegenLockTtlMinutes } from '../lib/docLock';

const USER_ID = new Types.ObjectId();

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
    commitSha: 'abc123',
    version: 1,
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
  delete process.env.REGEN_LOCK_TTL_MINUTES;
  await stopMongo();
});

beforeEach(async () => {
  await clearDb();
  delete process.env.REGEN_LOCK_TTL_MINUTES;
});

describe('getRegenLockTtlMinutes', () => {
  it('defaults to 10 minutes', () => {
    expect(getRegenLockTtlMinutes()).toBe(10);
  });

  it('reads a positive integer from the environment', () => {
    process.env.REGEN_LOCK_TTL_MINUTES = '3';
    expect(getRegenLockTtlMinutes()).toBe(3);
  });

  it('rejects garbage and non-positive values', () => {
    process.env.REGEN_LOCK_TTL_MINUTES = 'abc';
    expect(getRegenLockTtlMinutes()).toBe(10);
    process.env.REGEN_LOCK_TTL_MINUTES = '0';
    expect(getRegenLockTtlMinutes()).toBe(10);
    process.env.REGEN_LOCK_TTL_MINUTES = '-5';
    expect(getRegenLockTtlMinutes()).toBe(10);
  });
});

describe('acquireLock', () => {
  it('acquires a ready doc and records holder + timestamp', async () => {
    const doc = await makeDoc();

    const result = await acquireLock(doc._id as Types.ObjectId, USER_ID);

    expect(result).not.toBeNull();
    expect(result!.status).toBe('generating');
    expect(result!.lockedBy?.toString()).toBe(USER_ID.toString());
    expect(result!.lockedAt).toBeInstanceOf(Date);
  });

  it('refuses when another holder holds a fresh lock', async () => {
    const doc = await makeDoc({ status: 'generating', lockedAt: new Date() });

    const result = await acquireLock(doc._id as Types.ObjectId, USER_ID);

    expect(result).toBeNull();
  });

  it('takes over an expired lock', async () => {
    const stale = new Date(Date.now() - 11 * 60_000);
    const doc = await makeDoc({ status: 'generating', lockedAt: stale });

    const result = await acquireLock(doc._id as Types.ObjectId, USER_ID);

    expect(result).not.toBeNull();
    expect(result!.lockedBy?.toString()).toBe(USER_ID.toString());
  });

  it('honors REGEN_LOCK_TTL_MINUTES for staleness', async () => {
    process.env.REGEN_LOCK_TTL_MINUTES = '5';

    const almostStale = new Date(Date.now() - 4 * 60_000);
    const fresh = await makeDoc({
      status: 'generating',
      lockedAt: almostStale,
      slug: 'fresh-lock',
    });
    expect(await acquireLock(fresh._id as Types.ObjectId, USER_ID)).toBeNull();

    const stale = new Date(Date.now() - 6 * 60_000);
    const expired = await makeDoc({
      status: 'generating',
      lockedAt: stale,
      slug: 'expired-lock',
      repoId: 1296270,
    });
    const taken = await acquireLock(expired._id as Types.ObjectId, USER_ID);
    expect(taken).not.toBeNull();
  });

  it('recovers a generating doc that somehow has no lockedAt', async () => {
    const doc = await makeDoc({ status: 'generating' });

    const result = await acquireLock(doc._id as Types.ObjectId, USER_ID);

    expect(result).not.toBeNull();
    expect(result!.lockedAt).toBeInstanceOf(Date);
  });
});

describe('releaseLock', () => {
  it('clears the lock and returns the doc to ready', async () => {
    const doc = await makeDoc();
    await acquireLock(doc._id as Types.ObjectId, USER_ID);

    await releaseLock(doc._id as Types.ObjectId, USER_ID);

    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.status).toBe('ready');
    expect(fresh!.lockedAt).toBeUndefined();
    expect(fresh!.lockedBy).toBeUndefined();
  });

  it('does not release a lock held by someone else', async () => {
    const other = new Types.ObjectId();
    const doc = await makeDoc();
    await acquireLock(doc._id as Types.ObjectId, other);

    await releaseLock(doc._id as Types.ObjectId, USER_ID);

    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.status).toBe('generating');
    expect(fresh!.lockedBy?.toString()).toBe(other.toString());
  });

  it('is a no-op when the lock is already gone', async () => {
    const doc = await makeDoc();

    await releaseLock(doc._id as Types.ObjectId, USER_ID);

    const fresh = await GeneratedDocModel.findById(doc._id);
    expect(fresh!.status).toBe('ready');
  });
});
